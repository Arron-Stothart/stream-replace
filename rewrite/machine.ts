import type { Program } from './program.ts';

export interface Thread {
  readonly instruction: number;
  readonly start: number;
  readonly captures: readonly (number | null)[];
}

export interface Acceptance {
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (number | null)[];
}

export interface State {
  readonly position: number;
  readonly searching: boolean;
  readonly threads: readonly Thread[];
  readonly candidate: Acceptance | null;
}

export type Decision =
  | { readonly kind: 'pending'; readonly start: number }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'matched'; readonly match: Acceptance };

function settle<Symbol>(
  program: Program<Symbol>,
  seeds: readonly Thread[],
  position: number,
  candidate: Acceptance | null,
  searching: boolean,
): State {
  const pending = [...seeds].reverse();
  const visited = new Set<number>();
  const threads: Thread[] = [];

  while (pending.length > 0) {
    const thread = pending.pop()!;
    if (visited.has(thread.instruction)) continue;
    visited.add(thread.instruction);

    const instruction = program.instructions[thread.instruction];
    switch (instruction.kind) {
      case 'accept':
        return {
          position,
          searching,
          threads,
          candidate: { start: thread.start, end: position, captures: thread.captures },
        };
      case 'reject':
        break;
      case 'consume':
        threads.push(thread);
        break;
      case 'fork':
        pending.push(
          { ...thread, instruction: instruction.fallback },
          { ...thread, instruction: instruction.preferred },
        );
        break;
      case 'save': {
        const captures = [...thread.captures];
        captures[instruction.slot] = position;
        pending.push({ ...thread, instruction: instruction.next, captures });
        break;
      }
    }
  }

  return { position, searching, threads, candidate };
}

function enter<Symbol>(program: Program<Symbol>, position: number): Thread {
  return {
    instruction: program.entry,
    start: position,
    captures: Array<number | null>(program.captures.length * 2).fill(null),
  };
}

export function start<Symbol>(program: Program<Symbol>, mode: 'anchored' | 'search' = 'anchored'): State {
  return settle(program, [enter(program, 0)], 0, null, mode === 'search');
}

export function decide(state: State): Decision {
  if (state.threads.length > 0) return { kind: 'pending', start: state.threads[0].start };
  if (state.candidate !== null) return { kind: 'matched', match: state.candidate };
  if (state.searching) return { kind: 'pending', start: state.position };
  return { kind: 'rejected' };
}

export function advance<Symbol>(program: Program<Symbol>, state: State, symbol: Symbol): State {
  if (decide(state).kind !== 'pending') throw new Error('Cannot advance a settled match');
  const seeds: Thread[] = [];

  for (const thread of state.threads) {
    const instruction = program.instructions[thread.instruction];
    if (instruction.kind === 'consume' && instruction.accepts(symbol)) {
      seeds.push({ ...thread, instruction: instruction.next });
    }
  }

  const position = state.position + 1;
  if (state.searching && state.candidate === null) seeds.push(enter(program, position));
  return settle(program, seeds, position, state.candidate, state.searching);
}

export function finish(state: State): State {
  return { ...state, threads: [], searching: false };
}
