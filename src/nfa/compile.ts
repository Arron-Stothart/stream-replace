import type { Expression } from '../syntax/expression.js';
import type { Instruction, Program } from './program.js';

function numberCaptures(root: Expression): {
  readonly names: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly inside: ReadonlyMap<Expression, readonly [number, number]>;
} {
  const names: string[] = [];
  const index = new Map<string, number>();
  const inside = new Map<Expression, readonly [number, number]>();
  const pending: (
    | Expression
    | { readonly leave: Expression; readonly from: number }
  )[] = [root];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if ('leave' in item) {
      inside.set(item.leave, [item.from, names.length]);
      continue;
    }
    pending.push({ leave: item, from: names.length });
    switch (item.kind) {
      case 'capture':
        if (index.has(item.name))
          throw new SyntaxError(`Duplicate capture name: ${item.name}`);
        index.set(item.name, names.push(item.name) - 1);
        pending.push(item.body);
        break;
      case 'sequence':
        for (let index = item.parts.length - 1; index >= 0; index--)
          pending.push(item.parts[index]);
        break;
      case 'choice':
        for (let index = item.alternatives.length - 1; index >= 0; index--)
          pending.push(item.alternatives[index]);
        break;
      case 'repeat':
        pending.push(item.body);
        break;
    }
  }
  return { names, index, inside };
}

export function compile(expression: Expression): Program {
  const { names, index, inside } = numberCaptures(expression);
  const instructions: Instruction[] = [];
  const emit = (instruction: Instruction): number =>
    instructions.push(instruction) - 1;

  type Request = readonly [Expression, number];

  function* iteration(
    body: Expression,
    next: number,
  ): Generator<Request, number, number> {
    const entry = yield [body, next];
    const [from, to] = inside.get(body)!;
    return from === to
      ? entry
      : emit({ kind: 'reset', from: from * 2, to: to * 2, next: entry });
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
        const slot = index.get(expression.name)! * 2;
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
  return { entry, instructions, captures: names };
}
