import {
  contains,
  holds,
  holdsWithoutNext,
  width,
  type Range,
} from './alphabet.js';
import { firstCodePoints, type Automaton } from './automaton.js';

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Input {
  readonly end: number;
  readonly closed: boolean;
  codePointAt(offset: number): number;
  codePointBefore(offset: number): number | undefined;
}

export interface Decisions {
  outside(from: number, to: number): void;
  inside(from: number, to: number): void;
  match(start: number, end: number, captures: readonly (Span | null)[]): void;
}

type Status = 'blocked' | 'matched' | 'searching' | 'too-long';

const END = -1;
const UNKNOWN = -2;
const UNSET = -1;
const POSITIONS_PER_CHUNK = 256;

type Slots = Float64Array;

class PositionSets {
  private readonly stride: number;
  private readonly chunks = new Map<number, Uint32Array>();
  private firstChunk = 0;
  private minPosition = Infinity;
  private maxPosition = -Infinity;

  constructor(states: number) {
    this.stride = (states + 31) >>> 5;
  }

  add(position: number, states: Int32Array, count: number): void {
    const key = Math.floor(position / POSITIONS_PER_CHUNK);
    const existing = this.chunks.get(key);
    const chunk =
      existing ?? new Uint32Array(POSITIONS_PER_CHUNK * this.stride);
    if (existing === undefined) this.chunks.set(key, chunk);
    this.minPosition = Math.min(this.minPosition, position);
    this.maxPosition = Math.max(this.maxPosition, position);
    const base = (position - key * POSITIONS_PER_CHUNK) * this.stride;
    for (const state of states.subarray(0, count))
      chunk[base + (state >>> 5)] |= 1 << (state & 31);
  }

  mark(position: number, visited: Int32Array, stamp: number): void {
    const key = Math.floor(position / POSITIONS_PER_CHUNK);
    const chunk = this.chunks.get(key);
    if (chunk === undefined) return;
    const base = (position - key * POSITIONS_PER_CHUNK) * this.stride;
    for (let word = 0; word < this.stride; word++)
      for (let bits = chunk[base + word]; bits !== 0; bits &= bits - 1)
        visited[word * 32 + 31 - Math.clz32(bits & -bits)] = stamp;
  }

  absorb(other: PositionSets): void {
    const { stride } = this;
    for (const [key, source] of other.chunks) {
      const target = this.chunks.get(key);
      if (target === undefined) {
        this.chunks.set(key, source);
        continue;
      }
      const first =
        Math.max(other.minPosition - key * POSITIONS_PER_CHUNK, 0) * stride;
      const last =
        (Math.min(
          other.maxPosition - key * POSITIONS_PER_CHUNK,
          POSITIONS_PER_CHUNK - 1,
        ) +
          1) *
        stride;
      for (let index = first; index < last; index++)
        target[index] |= source[index];
    }
    other.clear();
  }

  drop(before: number): void {
    const limit = Math.floor(before / POSITIONS_PER_CHUNK);
    for (; this.firstChunk < limit; this.firstChunk++)
      this.chunks.delete(this.firstChunk);
  }

  clear(): void {
    if (this.chunks.size === 0) return;
    this.chunks.clear();
    this.minPosition = Infinity;
    this.maxPosition = -Infinity;
  }
}

class Threads {
  readonly state: Int32Array;
  readonly start: Float64Array;
  readonly slots: Slots[];
  length = 0;

  constructor(capacity: number) {
    this.state = new Int32Array(capacity);
    this.start = new Float64Array(capacity);
    this.slots = new Array<Slots>(capacity);
  }

  push(state: number, start: number, slots: Slots): void {
    const index = this.length++;
    this.state[index] = state;
    this.start[index] = start;
    this.slots[index] = slots;
  }
}

class Vm {
  private readonly automaton: Automaton;
  private readonly first: readonly Range[] | null;
  private readonly empty: Slots;
  private readonly limit: number;
  private threads: Threads;
  private spare: Threads;
  private expanded = false;
  private candidate: { start: number; end: number; slots: Slots } | null = null;
  private at = 0;
  private readonly visited: Int32Array;
  private readonly reached: Int32Array;
  private stamp = 0;
  private readonly failed: PositionSets;
  private readonly suspected: PositionSets;
  private droppedTooLong = false;
  private droppedStart = -1;
  private readonly stack = {
    state: [] as number[],
    start: [] as number[],
    slots: [] as Slots[],
  };

  constructor(automaton: Automaton, limit: number) {
    this.automaton = automaton;
    this.limit = limit;
    this.first = firstCodePoints(automaton);
    const states = automaton.states.length;
    this.empty = new Float64Array(automaton.captures.length * 2).fill(UNSET);
    this.threads = new Threads(states);
    this.spare = new Threads(states);
    this.visited = new Int32Array(states);
    this.reached = new Int32Array(states);
    this.failed = new PositionSets(states);
    this.suspected = new PositionSets(states);
  }

  get position(): number {
    return this.at;
  }

  get tooLongStart(): number {
    return this.droppedStart;
  }

  get earliestLiveStart(): number {
    if (this.threads.length > 0) return this.threads.start[0];
    return this.candidate?.start ?? this.at;
  }

  get certainEnd(): number | null {
    const candidate = this.candidate;
    return candidate !== null && this.earliestLiveStart === candidate.start
      ? candidate.end
      : null;
  }

  accepted(): { start: number; end: number; captures: (Span | null)[] } {
    const { start, end, slots } = this.candidate!;
    const captures: (Span | null)[] = [];
    for (let slot = 0; slot < slots.length; slot += 2)
      captures.push(
        slots[slot] === UNSET || slots[slot + 1] === UNSET
          ? null
          : { start: slots[slot], end: slots[slot + 1] },
      );
    return { start, end, captures };
  }

  restart(position: number): void {
    if (this.droppedTooLong) this.suspected.clear();
    else this.failed.absorb(this.suspected);
    this.failed.drop(position);
    this.droppedTooLong = false;
    this.droppedStart = -1;
    this.threads.length = 0;
    this.expanded = false;
    this.candidate = null;
    this.at = position;
  }

  advance(previous: number | undefined, next: number, width: number): Status {
    if (
      this.first !== null &&
      next >= 0 &&
      this.threads.length === 0 &&
      this.candidate === null &&
      !contains(this.first, next)
    ) {
      this.at += width;
      this.expanded = false;
      return 'searching';
    }
    if (!this.expanded) {
      if (!this.expand(previous, next)) return 'blocked';
      this.expanded = true;
    }
    if (next === END) this.threads.length = 0;
    else if (next !== UNKNOWN) {
      this.step(next, width);
      if (this.droppedStart >= 0 && this.candidate?.start !== this.droppedStart)
        return 'too-long';
    }
    return this.candidate !== null && this.threads.length === 0
      ? 'matched'
      : 'searching';
  }

  private expand(previous: number | undefined, next: number): boolean {
    const { states, entry } = this.automaton;
    const { visited, reached, stack, suspected } = this;
    const seeds = this.threads;
    const ready = this.spare;
    const at = this.at;
    const following = next < 0 ? undefined : next;
    const recording = this.candidate !== null;
    let count = 0;
    if (this.stamp === 0x7fffffff) {
      visited.fill(0);
      this.stamp = 0;
    }
    const stamp = ++this.stamp;
    this.failed.mark(at, visited, stamp);
    ready.length = 0;
    let accepted: { start: number; end: number; slots: Slots } | null = null;

    const seedCount = seeds.length + (this.candidate === null ? 1 : 0);
    search: for (let seed = 0; seed < seedCount; seed++) {
      if (seed < seeds.length) {
        stack.state.push(seeds.state[seed]);
        stack.start.push(seeds.start[seed]);
        stack.slots.push(seeds.slots[seed]);
      } else {
        stack.state.push(entry);
        stack.start.push(at);
        stack.slots.push(this.empty);
      }
      while (stack.state.length > 0) {
        const index = stack.state.pop()!;
        const start = stack.start.pop()!;
        const slots = stack.slots.pop()!;
        if (visited[index] === stamp) continue;
        visited[index] = stamp;
        if (recording) reached[count++] = index;
        const state = states[index];
        switch (state.kind) {
          case 'accept':
            accepted = { start, end: at, slots };
            break search;
          case 'consume':
            ready.push(index, start, slots);
            continue;
          case 'assert': {
            const passes =
              next === UNKNOWN
                ? holdsWithoutNext(state.boundary, previous)
                : holds(state.boundary, previous, following);
            if (passes === undefined) {
              stack.state.length = stack.start.length = stack.slots.length = 0;
              return false;
            }
            if (passes) this.push(state.next, start, slots);
            continue;
          }
          case 'save': {
            const written = slots.slice();
            written[state.slot] = at;
            this.push(state.next, start, written);
            continue;
          }
          case 'reset': {
            const touched = slots
              .subarray(state.from, state.to)
              .some((slot) => slot !== UNSET);
            const cleared = touched
              ? slots.slice().fill(UNSET, state.from, state.to)
              : slots;
            this.push(state.next, start, cleared);
            continue;
          }
          case 'choose':
            for (
              let successor = state.successors.length - 1;
              successor >= 0;
              successor--
            )
              this.push(state.successors[successor], start, slots);
            continue;
        }
      }
    }
    stack.state.length = stack.start.length = stack.slots.length = 0;

    if (accepted !== null) {
      this.candidate = accepted;
      suspected.clear();
    } else if (recording) suspected.add(at, reached, count);
    this.spare = seeds;
    this.threads = ready;
    return true;
  }

  private push(state: number, start: number, slots: Slots): void {
    this.stack.state.push(state);
    this.stack.start.push(start);
    this.stack.slots.push(slots);
  }

  private step(symbol: number, width: number): void {
    const { states } = this.automaton;
    const ready = this.threads;
    const following = this.spare;
    const oldestAllowed = this.at + width - this.limit;
    following.length = 0;
    this.droppedStart = -1;
    for (let index = 0; index < ready.length; index++) {
      const state = states[ready.state[index]];
      if (state.kind !== 'consume' || !contains(state.ranges, symbol)) continue;
      const start = ready.start[index];
      if (start < oldestAllowed) {
        if (this.droppedStart < 0) this.droppedStart = start;
        this.droppedTooLong = true;
      } else following.push(state.next, start, ready.slots[index]);
    }
    this.spare = ready;
    this.threads = following;
    this.expanded = false;
    this.at += width;
  }
}

export class Search {
  private readonly vm: Vm;
  private decided = 0;
  private announced = -1;
  private afterEmptyMatch = false;

  constructor(automaton: Automaton, limit: number) {
    this.vm = new Vm(automaton, limit);
  }

  run(input: Input, decisions: Decisions): void {
    const { vm } = this;
    while (true) {
      if (this.afterEmptyMatch) {
        if (this.decided === input.end) return;
        this.resume(input, decisions, this.decided);
      }
      const at = vm.position;
      const next =
        at < input.end ? input.codePointAt(at) : input.closed ? END : UNKNOWN;
      const status = vm.advance(
        input.codePointBefore(at),
        next,
        next < 0 ? 0 : width(next),
      );
      if (status === 'matched') {
        this.match(decisions);
        continue;
      }
      if (status === 'too-long') {
        this.resume(input, decisions, vm.tooLongStart);
        continue;
      }
      const certain = status === 'searching' ? vm.certainEnd : null;
      if (certain !== null && certain > this.announced) {
        const start = vm.earliestLiveStart;
        this.decideUpTo(decisions, start);
        decisions.inside(Math.max(this.announced, start), certain);
        this.announced = certain;
      }
      if (status === 'blocked' || next < 0) {
        this.decideUpTo(decisions, vm.earliestLiveStart);
        return;
      }
    }
  }

  private resume(input: Input, decisions: Decisions, from: number): void {
    this.decideUpTo(decisions, from + width(input.codePointAt(from)));
    this.afterEmptyMatch = false;
    this.announced = -1;
    this.vm.restart(this.decided);
  }

  private match(decisions: Decisions): void {
    const { start, end, captures } = this.vm.accepted();
    this.decideUpTo(decisions, start);
    decisions.match(start, end, captures);
    this.decided = end;
    this.announced = -1;
    this.afterEmptyMatch = start === end;
    if (!this.afterEmptyMatch) this.vm.restart(end);
  }

  private decideUpTo(decisions: Decisions, to: number): void {
    if (to <= this.decided) return;
    decisions.outside(this.decided, to);
    this.decided = to;
  }
}
