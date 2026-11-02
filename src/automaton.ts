import { normalize, type Boundary, type Range } from './alphabet.ts';
import type { Expression } from './syntax.ts';

const MAX_INSTRUCTIONS = 65_536;

type Step =
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
    };

type Instruction =
  | Step
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | {
      readonly kind: 'fork';
      readonly preferred: number;
      readonly fallback: number;
    }
  | { readonly kind: 'iterate'; readonly next: number }
  | { readonly kind: 'progress'; readonly next: number };

interface Program {
  readonly entry: number;
  readonly instructions: readonly Instruction[];
  readonly captures: readonly (string | null)[];
}

type State =
  | Step
  | { readonly kind: 'accept' }
  | { readonly kind: 'choose'; readonly successors: readonly number[] };

export interface Automaton {
  readonly entry: number;
  readonly states: readonly State[];
  readonly captures: readonly (string | null)[];
}

export function compile(expression: Expression): Automaton {
  return trackProgress(program(expression));
}

export function firstCodePoints(automaton: Automaton): readonly Range[] | null {
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

function capturesIn(root: Expression): Map<number, string | null> {
  const found = new Map<number, string | null>();
  const pending = [root];
  while (pending.length > 0) {
    const expression = pending.pop()!;
    switch (expression.kind) {
      case 'capture':
        found.set(expression.index, expression.name);
        pending.push(expression.body);
        break;
      case 'sequence':
        for (const part of expression.parts) pending.push(part);
        break;
      case 'choice':
        for (const alternative of expression.alternatives)
          pending.push(alternative);
        break;
      case 'repeat':
        pending.push(expression.body);
        break;
    }
  }
  return found;
}

function program(expression: Expression): Program {
  const instructions: Instruction[] = [];
  const named = capturesIn(expression);
  const count = [...named.keys()].reduce(
    (most, index) => Math.max(most, index + 1),
    0,
  );
  const captures = Array.from(
    { length: count },
    (_, index) => named.get(index) ?? null,
  );
  const emit = (instruction: Instruction): number => {
    if (instructions.length === MAX_INSTRUCTIONS)
      throw new RangeError(
        'This pattern is too large. Use smaller repeat counts, such as {100} instead of {100000}.',
      );
    return instructions.push(instruction) - 1;
  };
  const reserve = (): number => emit({ kind: 'reject' });

  type Request = readonly [Expression, number];
  type Reset = readonly [from: number, to: number] | null;

  function resetOf(body: Expression): Reset {
    const inside = [...capturesIn(body).keys()];
    if (inside.length === 0) return null;
    const from = inside.reduce((low, index) => Math.min(low, index));
    return [from * 2, (from + inside.length) * 2];
  }

  function* iteration(
    body: Expression,
    reset: Reset,
    next: number,
  ): Generator<Request, number, number> {
    const entry = yield [body, next];
    if (reset === null) return entry;
    return emit({ kind: 'reset', from: reset[0], to: reset[1], next: entry });
  }

  function* optional(
    body: Expression,
    reset: Reset,
    greedy: boolean,
    head: number,
    again: number,
    next: number,
  ): Generator<Request, number, number> {
    const progress = emit({ kind: 'progress', next: again });
    const start = emit({
      kind: 'iterate',
      next: yield* iteration(body, reset, progress),
    });
    instructions[head] = greedy
      ? { kind: 'fork', preferred: start, fallback: next }
      : { kind: 'fork', preferred: next, fallback: start };
    return head;
  }

  function* emitExpression(
    expression: Expression,
    next: number,
  ): Generator<Request, number, number> {
    switch (expression.kind) {
      case 'chars':
        return emit({ kind: 'consume', ranges: expression.ranges, next });
      case 'assert':
        return emit({ kind: 'assert', boundary: expression.boundary, next });
      case 'sequence':
        for (let index = expression.parts.length - 1; index >= 0; index--)
          next = yield [expression.parts[index], next];
        return next;
      case 'choice': {
        if (expression.alternatives.length === 0)
          return emit({ kind: 'reject' });
        const entries: number[] = [];
        for (const alternative of expression.alternatives)
          entries.push(yield [alternative, next]);
        return entries
          .slice(0, -1)
          .reduceRight(
            (fallback, preferred) =>
              emit({ kind: 'fork', preferred, fallback }),
            entries[entries.length - 1],
          );
      }
      case 'repeat': {
        const { body, minimum, maximum, greedy } = expression;
        const reset = resetOf(body);
        let entry = next;
        if (maximum === Infinity) {
          const loop = reserve();
          entry = yield* optional(body, reset, greedy, loop, loop, next);
        } else
          for (let count = minimum; count < maximum; count++)
            entry = yield* optional(
              body,
              reset,
              greedy,
              reserve(),
              entry,
              next,
            );
        for (let count = 0; count < minimum; count++)
          entry = yield* iteration(body, reset, entry);
        return entry;
      }
      case 'capture': {
        const slot = expression.index * 2;
        const end = emit({ kind: 'save', slot: slot + 1, next });
        return emit({ kind: 'save', slot, next: yield [expression.body, end] });
      }
    }
  }

  const stack = [emitExpression(expression, emit({ kind: 'accept' }))];
  let entry = 0;
  while (stack.length > 0) {
    const step = stack[stack.length - 1].next(entry);
    if (step.done) {
      stack.pop();
      entry = step.value;
    } else stack.push(emitExpression(...step.value));
  }
  return { entry, instructions, captures };
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
    (instruction) => instruction.kind === 'progress',
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

function trackProgress(program: Program): Automaton {
  const observed = observesProgress(program);
  const base: number[] = [];
  let count = 0;
  for (const tracked of observed) {
    base.push(count);
    count += tracked ? 2 : 1;
  }
  const state = (instruction: number, progressed: boolean): number =>
    base[instruction] + (observed[instruction] && progressed ? 1 : 0);

  function lowered(instruction: Instruction, progressed: boolean): State {
    switch (instruction.kind) {
      case 'accept':
        return { kind: 'accept' };
      case 'reject':
        return { kind: 'choose', successors: [] };
      case 'consume':
        return { ...instruction, next: state(instruction.next, true) };
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
    states.push(lowered(instruction, false));
    if (observed[index]) states.push(lowered(instruction, true));
  });
  return {
    entry: state(program.entry, false),
    states,
    captures: program.captures,
  };
}
