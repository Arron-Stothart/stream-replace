import type { Boundary, Context } from './boundary.js';
import type { Range } from './alphabet.js';
import type { Instruction, Program } from './program.js';

export type Step<Symbol> =
  | { readonly kind: 'accept'; readonly progressed: boolean }
  | {
      readonly kind: 'consume';
      readonly accepts: (symbol: Symbol) => boolean;
      readonly ranges?: readonly Range[];
      readonly next: number;
    }
  | {
      readonly kind: 'assert';
      readonly accepts: (context: Context<Symbol>) => boolean | undefined;
      readonly boundary?: Boundary;
      readonly ranges?: readonly Range[];
      readonly next: number;
    }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number }
  | { readonly kind: 'choose'; readonly successors: readonly number[] };

export interface Machine<Symbol> {
  readonly entry: number;
  readonly steps: readonly Step<Symbol>[];
  readonly captures: number;
}

function successors<Symbol>(instruction: Instruction<Symbol>): number[] {
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

function liveProgress<Symbol>(program: Program<Symbol>): boolean[] {
  const { instructions } = program;
  const live = instructions.map(
    (instruction) =>
      instruction.kind === 'accept' || instruction.kind === 'progress',
  );
  const predecessors: number[][] = instructions.map(() => []);
  instructions.forEach((instruction, index) => {
    if (instruction.kind === 'consume' || instruction.kind === 'iterate')
      return;
    for (const next of successors(instruction)) predecessors[next].push(index);
  });
  const pending = live.flatMap((isLive, index) => (isLive ? [index] : []));
  while (pending.length > 0) {
    for (const predecessor of predecessors[pending.pop()!]) {
      if (live[predecessor]) continue;
      live[predecessor] = true;
      pending.push(predecessor);
    }
  }
  return live;
}

export function machine<Symbol>(program: Program<Symbol>): Machine<Symbol> {
  const live = liveProgress(program);
  const base: number[] = [];
  let count = 0;
  for (const isLive of live) {
    base.push(count);
    count += isLive ? 2 : 1;
  }
  const thread = (instruction: number, progressed: boolean): number =>
    base[instruction] + (live[instruction] && progressed ? 1 : 0);

  function step(instruction: number, progressed: boolean): Step<Symbol> {
    const operation = program.instructions[instruction];
    switch (operation.kind) {
      case 'accept':
        return { kind: 'accept', progressed };
      case 'reject':
        return { kind: 'choose', successors: [] };
      case 'consume':
        return {
          kind: 'consume',
          accepts: operation.accepts,
          ranges: operation.ranges,
          next: thread(operation.next, true),
        };
      case 'assert':
        return {
          kind: 'assert',
          accepts: operation.accepts,
          boundary: operation.boundary,
          ranges: operation.ranges,
          next: thread(operation.next, progressed),
        };
      case 'save':
        return {
          kind: 'save',
          slot: operation.slot,
          next: thread(operation.next, progressed),
        };
      case 'fork':
        return {
          kind: 'choose',
          successors: [
            thread(operation.preferred, progressed),
            thread(operation.fallback, progressed),
          ],
        };
      case 'iterate':
        return { kind: 'choose', successors: [thread(operation.next, false)] };
      case 'progress':
        return {
          kind: 'choose',
          successors: progressed ? [thread(operation.next, true)] : [],
        };
    }
  }

  const steps: Step<Symbol>[] = [];
  live.forEach((isLive, instruction) => {
    steps.push(step(instruction, false));
    if (isLive) steps.push(step(instruction, true));
  });
  return {
    entry: thread(program.entry, false),
    steps,
    captures: program.captures.length,
  };
}
