import type { Expression } from '../syntax/expression.js';
import type { Instruction, Program } from './program.js';

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

export function compile(expression: Expression): Program {
  const instructions: Instruction[] = [];
  const named = capturesIn(expression);
  let count = 0;
  for (const index of named.keys()) count = Math.max(count, index + 1);
  const captures = Array.from(
    { length: count },
    (_, index) => named.get(index) ?? null,
  );
  const emit = (instruction: Instruction): number =>
    instructions.push(instruction) - 1;

  type Request = readonly [Expression, number];

  function* iteration(
    body: Expression,
    next: number,
  ): Generator<Request, number, number> {
    const entry = yield [body, next];
    const inside = [...capturesIn(body).keys()];
    if (inside.length === 0) return entry;
    const from = inside.reduce((low, index) => Math.min(low, index));
    return emit({
      kind: 'reset',
      from: from * 2,
      to: (from + inside.length) * 2,
      next: entry,
    });
  }

  function* optional(
    body: Expression,
    greedy: boolean,
    again: number,
    next: number,
    head = emit({ kind: 'reject' }),
  ): Generator<Request, number, number> {
    const progress = emit({ kind: 'progress', next: again });
    const start = emit({
      kind: 'iterate',
      next: yield* iteration(body, progress),
    });
    instructions[head] = greedy
      ? { kind: 'fork', preferred: start, fallback: next }
      : { kind: 'fork', preferred: next, fallback: start };
    return head;
  }

  function* lower(
    expression: Expression,
    next: number,
  ): Generator<Request, number, number> {
    switch (expression.kind) {
      case 'empty':
        return next;
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
        let entry = entries[entries.length - 1];
        for (let index = entries.length - 2; index >= 0; index--)
          entry = emit({
            kind: 'fork',
            preferred: entries[index],
            fallback: entry,
          });
        return entry;
      }
      case 'repeat': {
        const { body, minimum, maximum, greedy } = expression;
        let entry = next;
        if (maximum === Infinity) {
          const loop = emit({ kind: 'reject' });
          entry = yield* optional(body, greedy, loop, next, loop);
        } else
          for (let count = minimum; count < maximum; count++)
            entry = yield* optional(body, greedy, entry, next);
        for (let count = 0; count < minimum; count++)
          entry = yield* iteration(body, entry);
        return entry;
      }
      case 'capture': {
        const slot = expression.index * 2;
        const end = emit({ kind: 'save', slot: slot + 1, next });
        return emit({ kind: 'save', slot, next: yield [expression.body, end] });
      }
    }
  }

  const stack = [lower(expression, emit({ kind: 'accept' }))];
  let entry = 0;
  let resumed = false;
  while (stack.length > 0) {
    const step = resumed
      ? stack[stack.length - 1].next(entry)
      : stack[stack.length - 1].next();
    if (step.done) {
      stack.pop();
      entry = step.value;
      resumed = true;
    } else {
      stack.push(lower(...step.value));
      resumed = false;
    }
  }
  return { entry, instructions, captures };
}
