import type { Boundary } from '../syntax/boundary.js';
import type { Range } from '../syntax/charset.js';
import type { Instruction, Program } from './program.js';

export type State =
  | { readonly kind: 'accept'; readonly progressed: boolean }
  | {
      readonly kind: 'consume';
      readonly ranges: readonly Range[];
      readonly next: number;
    }
  | {
      readonly kind: 'assert';
      readonly boundary: Boundary;
      readonly next: number;
    }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number }
  | {
      readonly kind: 'reset';
      readonly from: number;
      readonly to: number;
      readonly next: number;
    }
  | { readonly kind: 'choose'; readonly successors: readonly number[] };

export interface Automaton {
  readonly entry: number;
  readonly states: readonly State[];
  readonly captures: readonly string[];
}

function successors(instruction: Instruction): readonly number[] {
  switch (instruction.kind) {
    case 'accept':
    case 'reject':
      return [];
    case 'fork':
      return [instruction.preferred, instruction.fallback];
    default:
      return [instruction.next];
  }
}

function observesProgress(program: Program): boolean[] {
  const { instructions } = program;
  const result = instructions.map(
    (instruction) =>
      instruction.kind === 'accept' || instruction.kind === 'progress',
  );
  const predecessors: number[][] = instructions.map(() => []);
  instructions.forEach((instruction, index) => {
    if (instruction.kind === 'consume' || instruction.kind === 'iterate')
      return;
    for (const next of successors(instruction)) predecessors[next].push(index);
  });
  const pending = result.flatMap((observed, index) =>
    observed ? [index] : [],
  );
  while (pending.length > 0)
    for (const predecessor of predecessors[pending.pop()!])
      if (!result[predecessor]) {
        result[predecessor] = true;
        pending.push(predecessor);
      }
  return result;
}

export function automaton(program: Program): Automaton {
  const observed = observesProgress(program);
  const base: number[] = [];
  let count = 0;
  for (const tracked of observed) {
    base.push(count);
    count += tracked ? 2 : 1;
  }
  const state = (instruction: number, progressed: boolean): number =>
    base[instruction] + (observed[instruction] && progressed ? 1 : 0);

  function lower(instruction: Instruction, progressed: boolean): State {
    switch (instruction.kind) {
      case 'accept':
        return { kind: 'accept', progressed };
      case 'reject':
        return { kind: 'choose', successors: [] };
      case 'consume':
        return {
          kind: 'consume',
          ranges: instruction.ranges,
          next: state(instruction.next, true),
        };
      case 'assert':
      case 'save':
      case 'reset':
        return { ...instruction, next: state(instruction.next, progressed) };
      case 'fork':
        return {
          kind: 'choose',
          successors: [
            state(instruction.preferred, progressed),
            state(instruction.fallback, progressed),
          ],
        };
      case 'iterate':
        return { kind: 'choose', successors: [state(instruction.next, false)] };
      case 'progress':
        return {
          kind: 'choose',
          successors: progressed ? [state(instruction.next, true)] : [],
        };
    }
  }

  const states: State[] = [];
  program.instructions.forEach((instruction, index) => {
    states.push(lower(instruction, false));
    if (observed[index]) states.push(lower(instruction, true));
  });
  return {
    entry: state(program.entry, false),
    states,
    captures: program.captures,
  };
}
