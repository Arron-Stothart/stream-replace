import { holds, holdsBefore } from '../syntax/boundary.js';
import { contains, normalize, type Range } from '../syntax/charset.js';
import type { Automaton } from '../nfa/automaton.js';

export const END = -1;
export const UNKNOWN = -2;

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Accepted extends Span {
  readonly captures: readonly (Span | null)[];
}

export type Status = 'blocked' | 'matched' | 'searching';

type Slots = Float64Array;

const UNSET = -1;

function firstCodePoints(automaton: Automaton): readonly Range[] | null {
  const ranges: Range[] = [];
  const seen = new Set<number>();
  const pending = [automaton.entry];
  while (pending.length > 0) {
    const index = pending.pop()!;
    if (seen.has(index)) continue;
    seen.add(index);
    const state = automaton.states[index];
    switch (state.kind) {
      case 'accept':
      case 'assert':
        return null;
      case 'consume':
        for (const range of state.ranges) ranges.push(range);
        break;
      case 'save':
      case 'reset':
        pending.push(state.next);
        break;
      case 'choose':
        for (const successor of state.successors) pending.push(successor);
        break;
    }
  }
  return normalize(ranges);
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

export class Vm {
  private readonly automaton: Automaton;
  private readonly first: readonly Range[] | null;
  private readonly empty: Slots;
  private threads: Threads;
  private spare: Threads;
  private expanded = false;
  private candidate: { start: number; end: number; slots: Slots } | null = null;
  private at = 0;
  private origin = 0;
  private readonly visited: Int32Array;
  private stamp = 0;
  private readonly failed = new Map<number, number[]>();
  private readonly trail = new Map<number, number[]>();
  private readonly stack = {
    state: [] as number[],
    start: [] as number[],
    slots: [] as Slots[],
  };

  constructor(automaton: Automaton) {
    this.automaton = automaton;
    this.first = firstCodePoints(automaton);
    const states = automaton.states.length;
    this.empty = new Float64Array(automaton.captures.length * 2).fill(UNSET);
    this.threads = new Threads(states);
    this.spare = new Threads(states);
    this.visited = new Int32Array(states);
  }

  get position(): number {
    return this.at;
  }

  get frontier(): number {
    if (this.threads.length > 0) return this.threads.start[0];
    return this.candidate?.start ?? this.at;
  }

  get certainEnd(): number {
    const candidate = this.candidate;
    return candidate !== null && this.frontier === candidate.start
      ? candidate.end
      : -1;
  }

  accepted(): Accepted {
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
    for (const [at, states] of this.trail) {
      const known = this.failed.get(at);
      if (known === undefined) this.failed.set(at, states);
      else for (const state of states) known.push(state);
    }
    this.trail.clear();
    for (let at = this.origin; at < position; at++) this.failed.delete(at);
    this.threads.length = 0;
    this.expanded = false;
    this.candidate = null;
    this.origin = this.at = position;
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
    else if (next !== UNKNOWN) this.step(next, width);
    return this.candidate !== null && this.threads.length === 0
      ? 'matched'
      : 'searching';
  }

  private expand(previous: number | undefined, next: number): boolean {
    const { states, entry } = this.automaton;
    const { visited, stack } = this;
    const seeds = this.threads;
    const ready = this.spare;
    const at = this.at;
    const following = next < 0 ? undefined : next;
    const expanded: number[] | null = this.candidate !== null ? [] : null;
    const stamp = ++this.stamp;
    const dead = this.failed.get(at);
    if (dead !== undefined) for (const state of dead) visited[state] = stamp;
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
        expanded?.push(index);
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
                ? holdsBefore(state.boundary, previous)
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
            let cleared = slots;
            for (let slot = state.from; slot < state.to; slot++)
              if (slots[slot] !== UNSET) {
                (cleared = slots.slice()).fill(UNSET, state.from, state.to);
                break;
              }
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
      this.trail.clear();
    } else if (expanded !== null) this.trail.set(at, expanded);
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
    following.length = 0;
    for (let index = 0; index < ready.length; index++) {
      const state = states[ready.state[index]];
      if (state.kind === 'consume' && contains(state.ranges, symbol))
        following.push(state.next, ready.start[index], ready.slots[index]);
    }
    this.spare = ready;
    this.threads = following;
    this.expanded = false;
    this.at += width;
  }
}
