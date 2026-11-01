import { holds, holdsBefore } from '../syntax/boundary.js';
import { contains } from '../syntax/charset.js';
import type { Automaton } from '../nfa/automaton.js';

interface Saved {
  readonly slot: number;
  readonly position: number | null;
  readonly previous: Saved | null;
}

interface Thread {
  readonly state: number;
  readonly start: number;
  readonly saved: Saved | null;
}

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly saved: Saved | null;
}

export interface Acceptance {
  readonly start: number;
  readonly end: number;
  readonly slots: readonly (number | null)[];
}

export type Lookahead =
  | { readonly kind: 'symbol'; readonly symbol: number }
  | { readonly kind: 'end' }
  | { readonly kind: 'unknown' };

export class Vm {
  private readonly automaton: Automaton;
  private threads: Thread[] = [];
  private expanded = false;
  private current: Candidate | null = null;
  private at = 0;
  private origin = 0;
  private readonly visited: Int32Array;
  private expansions = 0;
  private readonly failed = new Map<number, Set<number>>();
  private readonly trail = new Map<number, number[]>();

  constructor(automaton: Automaton) {
    this.automaton = automaton;
    this.visited = new Int32Array(automaton.states.length);
  }

  get position(): number {
    return this.at;
  }

  get settled(): boolean {
    return this.expanded && this.current !== null && this.threads.length === 0;
  }

  get frontier(): number {
    return this.threads[0]?.start ?? this.current?.start ?? this.at;
  }

  get certain(): { readonly start: number; readonly end: number } | null {
    const candidate = this.current;
    return candidate !== null && this.frontier === candidate.start
      ? candidate
      : null;
  }

  accepted(): Acceptance {
    const { start, end, saved } = this.current!;
    const slots: (number | null | undefined)[] = Array(
      this.automaton.captures.length * 2,
    ).fill(undefined);
    for (let entry = saved; entry !== null; entry = entry.previous)
      if (slots[entry.slot] === undefined) slots[entry.slot] = entry.position;
    return { start, end, slots: slots.map((slot) => slot ?? null) };
  }

  restart(position: number): void {
    for (const [at, states] of this.trail) {
      let known = this.failed.get(at);
      if (known === undefined) this.failed.set(at, (known = new Set()));
      for (const state of states) known.add(state);
    }
    this.trail.clear();
    for (let at = this.origin; at < position; at++) this.failed.delete(at);
    this.threads = [];
    this.expanded = false;
    this.current = null;
    this.origin = this.at = position;
  }

  expand(previous: number | undefined, next: Lookahead): boolean {
    if (this.expanded) return true;
    const { states, entry } = this.automaton;
    const at = this.at;
    const context = {
      previous,
      next: next.kind === 'symbol' ? next.symbol : undefined,
    };
    const seeds =
      this.current === null
        ? [...this.threads, { state: entry, start: at, saved: null }]
        : this.threads;
    const failed = this.failed.get(at);
    const recording = this.current !== null;
    const expanded: number[] = [];
    const ready: Thread[] = [];
    let accepted: Candidate | null = null;
    const stamp = ++this.expansions;
    const stack: Thread[] = [];

    search: for (const seed of seeds) {
      stack.push(seed);
      while (stack.length > 0) {
        const thread = stack.pop()!;
        if (this.visited[thread.state] === stamp || failed?.has(thread.state))
          continue;
        this.visited[thread.state] = stamp;
        if (recording) expanded.push(thread.state);
        const state = states[thread.state];
        switch (state.kind) {
          case 'accept':
            accepted = { start: thread.start, end: at, saved: thread.saved };
            break search;
          case 'consume':
            ready.push(thread);
            break;
          case 'assert': {
            const passes =
              next.kind === 'unknown'
                ? holdsBefore(state.boundary, previous)
                : holds(state.boundary, context);
            if (passes === undefined) return false;
            if (passes) stack.push({ ...thread, state: state.next });
            break;
          }
          case 'save':
            stack.push({
              state: state.next,
              start: thread.start,
              saved: { slot: state.slot, position: at, previous: thread.saved },
            });
            break;
          case 'reset': {
            let saved = thread.saved;
            for (let slot = state.from; slot < state.to; slot++)
              saved = { slot, position: null, previous: saved };
            stack.push({ state: state.next, start: thread.start, saved });
            break;
          }
          case 'choose':
            for (let index = state.successors.length - 1; index >= 0; index--)
              stack.push({ ...thread, state: state.successors[index] });
            break;
        }
      }
    }

    if (accepted !== null) {
      this.current = accepted;
      this.trail.clear();
    } else if (recording) this.trail.set(at, expanded);
    this.threads = ready;
    this.expanded = true;
    return true;
  }

  step(symbol: number, width: number): void {
    const { states } = this.automaton;
    const following: Thread[] = [];
    for (const thread of this.threads) {
      const state = states[thread.state];
      if (state.kind === 'consume' && contains(state.ranges, symbol))
        following.push({ ...thread, state: state.next });
    }
    this.threads = following;
    this.expanded = false;
    this.at += width;
  }

  halt(): void {
    this.threads = [];
  }
}
