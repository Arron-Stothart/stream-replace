import { choice, empty, repeat, sequence, type Expression } from './expression.ts';
import type { Instruction, Program } from './program.ts';

export function compile<Symbol>(expression: Expression<Symbol>): Program<Symbol> {
  const instructions: Instruction<Symbol>[] = [];
  const captureSlots = new Map<string, number>();

  function declareCaptures(expression: Expression<Symbol>): void {
    switch (expression.kind) {
      case 'capture':
        if (captureSlots.has(expression.name)) {
          throw new Error(`Duplicate capture: ${expression.name}`);
        }
        captureSlots.set(expression.name, captureSlots.size * 2);
        declareCaptures(expression.body);
        break;
      case 'sequence':
        expression.parts.forEach(declareCaptures);
        break;
      case 'choice':
        expression.alternatives.forEach(declareCaptures);
        break;
      case 'repeat':
      case 'quantify':
        declareCaptures(expression.body);
        break;
    }
  }

  function emit(instruction: Instruction<Symbol>): number {
    return instructions.push(instruction) - 1;
  }

  function lower(
    expression: Expression<Symbol>,
    continuation: number,
    emptyContinuation = continuation,
  ): number {
    switch (expression.kind) {
      case 'empty':
        return emptyContinuation;
      case 'assert':
        return emit({ kind: 'assert', accepts: expression.accepts, boundary: expression.boundary, next: emptyContinuation });
      case 'quantify': {
        const parts: Expression<Symbol>[] = [];
        for (let index = 0; index < expression.minimum; index++) parts.push(expression.body);
        if (expression.maximum === Infinity) parts.push(repeat(expression.body, expression.greedy));
        else for (let index = expression.minimum; index < expression.maximum; index++) {
          parts.push(expression.greedy ? choice(expression.body, empty()) : choice(empty(), expression.body));
        }
        return lower(sequence(...parts), continuation, emptyContinuation);
      }
      case 'symbol':
        return emit({ kind: 'consume', accepts: expression.accepts, next: continuation, ranges: expression.ranges });
      case 'sequence': {
        if (continuation === emptyContinuation) {
          return expression.parts.reduceRight((next, part) => lower(part, next), continuation);
        }
        let consumed = continuation;
        let empty = emptyContinuation;
        for (let index = expression.parts.length - 1; index >= 0; index--) {
          const part = expression.parts[index];
          empty = lower(part, consumed, empty);
          if (index > 0) consumed = lower(part, consumed);
        }
        return empty;
      }
      case 'choice': {
        if (expression.alternatives.length === 0) return emit({ kind: 'reject' });
        const entries = expression.alternatives.map((part) => lower(part, continuation, emptyContinuation));
        let fallback = entries[entries.length - 1];
        for (let index = entries.length - 2; index >= 0; index--) {
          fallback = emit({ kind: 'fork', preferred: entries[index], fallback });
        }
        return fallback;
      }
      case 'repeat': {
        const loop = emit({ kind: 'reject' });
        const body = lower(expression.body, loop, reject);
        instructions[loop] = expression.greedy
          ? { kind: 'fork', preferred: body, fallback: continuation }
          : { kind: 'fork', preferred: continuation, fallback: body };
        if (continuation === emptyContinuation) return loop;
        return emit(expression.greedy
          ? { kind: 'fork', preferred: body, fallback: emptyContinuation }
          : { kind: 'fork', preferred: emptyContinuation, fallback: body });
      }
      case 'capture': {
        const slot = captureSlots.get(expression.name)!;
        const end = emit({ kind: 'save', slot: slot + 1, next: continuation });
        const emptyEnd = continuation === emptyContinuation
          ? end
          : emit({ kind: 'save', slot: slot + 1, next: emptyContinuation });
        const body = lower(expression.body, end, emptyEnd);
        return emit({ kind: 'save', slot, next: body });
      }
    }
  }

  declareCaptures(expression);
  const reject = emit({ kind: 'reject' });
  const entry = lower(expression, emit({ kind: 'accept' }));
  return { entry, instructions, captures: [...captureSlots.keys()] };
}
