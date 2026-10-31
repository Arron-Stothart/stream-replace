import type { Program } from './program.ts';

export interface Thread {
  readonly instruction: number;
  readonly captures: readonly (number | null)[];
}

export interface Acceptance {
  readonly end: number;
  readonly captures: readonly (number | null)[];
}

export interface State {
  readonly position: number;
  readonly threads: readonly Thread[];
  readonly candidate: Acceptance | null;
}

export type Decision =
  | { readonly kind: 'pending' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'matched'; readonly match: Acceptance };

function settle<Symbol>(
  program: Program<Symbol>,
  seeds: readonly Thread[],
  position: number,
  candidate: Acceptance | null,
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
        return { position, threads, candidate: { end: position, captures: thread.captures } };
      case 'reject':
        break;
      case 'consume':
        threads.push(thread);
        break;
      case 'fork':
        pending.push(
          { instruction: instruction.fallback, captures: thread.captures },
          { instruction: instruction.preferred, captures: thread.captures },
        );
        break;
      case 'save': {
        const captures = [...thread.captures];
        captures[instruction.slot] = position;
        pending.push({ instruction: instruction.next, captures });
        break;
      }
    }
  }

  return { position, threads, candidate };
}

export function start<Symbol>(program: Program<Symbol>): State {
  return settle(program, [{
    instruction: program.entry,
    captures: Array<number | null>(program.captures.length * 2).fill(null),
  }], 0, null);
}

export function decide(state: State): Decision {
  if (state.threads.length > 0) return { kind: 'pending' };
  if (state.candidate === null) return { kind: 'rejected' };
  return { kind: 'matched', match: state.candidate };
}

export function advance<Symbol>(program: Program<Symbol>, state: State, symbol: Symbol): State {
  if (state.threads.length === 0) throw new Error('Cannot advance a settled match');
  const seeds: Thread[] = [];

  for (const thread of state.threads) {
    const instruction = program.instructions[thread.instruction];
    if (instruction.kind === 'consume' && instruction.accepts(symbol)) {
      seeds.push({ instruction: instruction.next, captures: thread.captures });
    }
  }

  return settle(program, seeds, state.position + 1, state.candidate);
}

export function finish(state: State): State {
  return { ...state, threads: [] };
}
