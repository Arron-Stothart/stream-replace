import { choice, empty, repeat, type Expression } from './expression.js';
import type { Instruction, Program } from './program.js';

export function compile<Symbol>(
  expression: Expression<Symbol>,
): Program<Symbol> {
  const instructions: Instruction<Symbol>[] = [];
  const captureSlots = new Map<string, number>();

  function declareCaptures(root: Expression<Symbol>): void {
    const pending = [root];
    while (pending.length > 0) {
      const expression = pending.pop()!;
      switch (expression.kind) {
        case 'capture':
          if (captureSlots.has(expression.name))
            throw new SyntaxError(`Duplicate capture: ${expression.name}`);
          captureSlots.set(expression.name, captureSlots.size * 2);
          pending.push(expression.body);
          break;
        case 'sequence':
          for (let index = expression.parts.length - 1; index >= 0; index--)
            pending.push(expression.parts[index]);
          break;
        case 'choice':
          for (
            let index = expression.alternatives.length - 1;
            index >= 0;
            index--
          )
            pending.push(expression.alternatives[index]);
          break;
        case 'repeat':
        case 'quantify':
          pending.push(expression.body);
          break;
      }
    }
  }

  function emit(instruction: Instruction<Symbol>): number {
    return instructions.push(instruction) - 1;
  }

  type Request = [Expression<Symbol>, number, number];

  function* lower(
    expression: Expression<Symbol>,
    continuation: number,
    emptyContinuation = continuation,
  ): Generator<Request, number, number> {
    switch (expression.kind) {
      case 'empty':
        return emptyContinuation;
      case 'assert':
        return emit({
          kind: 'assert',
          accepts: expression.accepts,
          boundary: expression.boundary,
          ranges: expression.ranges,
          next: emptyContinuation,
        });
      case 'quantify': {
        const parts: Expression<Symbol>[] = [];
        for (let index = 0; index < expression.minimum; index++)
          parts.push(expression.body);
        if (expression.maximum === Infinity)
          parts.push(repeat(expression.body, expression.greedy));
        else
          for (
            let index = expression.minimum;
            index < expression.maximum;
            index++
          ) {
            parts.push(
              expression.greedy
                ? choice(expression.body, empty())
                : choice(empty(), expression.body),
            );
          }
        return yield [
          { kind: 'sequence', parts },
          continuation,
          emptyContinuation,
        ];
      }
      case 'symbol':
        return emit({
          kind: 'consume',
          accepts: expression.accepts,
          next: continuation,
          ranges: expression.ranges,
        });
      case 'sequence': {
        if (continuation === emptyContinuation) {
          let next = continuation;
          for (let index = expression.parts.length - 1; index >= 0; index--)
            next = yield [expression.parts[index], next, next];
          return next;
        }
        let consumed = continuation;
        let empty = emptyContinuation;
        for (let index = expression.parts.length - 1; index >= 0; index--) {
          const part = expression.parts[index];
          empty = yield [part, consumed, empty];
          if (index > 0) consumed = yield [part, consumed, consumed];
        }
        return empty;
      }
      case 'choice': {
        if (expression.alternatives.length === 0)
          return emit({ kind: 'reject' });
        const entries: number[] = [];
        for (const part of expression.alternatives)
          entries.push(yield [part, continuation, emptyContinuation]);
        let fallback = entries[entries.length - 1];
        for (let index = entries.length - 2; index >= 0; index--) {
          fallback = emit({
            kind: 'fork',
            preferred: entries[index],
            fallback,
          });
        }
        return fallback;
      }
      case 'repeat': {
        const loop = emit({ kind: 'reject' });
        const body = yield [expression.body, loop, reject];
        instructions[loop] = expression.greedy
          ? { kind: 'fork', preferred: body, fallback: continuation }
          : { kind: 'fork', preferred: continuation, fallback: body };
        if (continuation === emptyContinuation) return loop;
        return emit(
          expression.greedy
            ? { kind: 'fork', preferred: body, fallback: emptyContinuation }
            : { kind: 'fork', preferred: emptyContinuation, fallback: body },
        );
      }
      case 'capture': {
        const slot = captureSlots.get(expression.name)!;
        const end = emit({ kind: 'save', slot: slot + 1, next: continuation });
        const emptyEnd =
          continuation === emptyContinuation
            ? end
            : emit({ kind: 'save', slot: slot + 1, next: emptyContinuation });
        const body = yield [expression.body, end, emptyEnd];
        return emit({ kind: 'save', slot, next: body });
      }
    }
  }

  declareCaptures(expression);
  const reject = emit({ kind: 'reject' });
  const pending = [lower(expression, emit({ kind: 'accept' }))];
  let entry: number | undefined;
  while (pending.length > 0) {
    const current = pending[pending.length - 1];
    const next = entry === undefined ? current.next() : current.next(entry);
    entry = undefined;
    if (next.done) {
      pending.pop();
      entry = next.value;
    } else pending.push(lower(...next.value));
  }
  return { entry: entry!, instructions, captures: [...captureSlots.keys()] };
}
