import type { Expression } from './expression.ts';
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
        declareCaptures(expression.body);
        break;
    }
  }

  function emit(instruction: Instruction<Symbol>): number {
    return instructions.push(instruction) - 1;
  }

  function lower(expression: Expression<Symbol>, continuation: number): number {
    switch (expression.kind) {
      case 'empty':
        return continuation;
      case 'symbol':
        return emit({ kind: 'consume', accepts: expression.accepts, next: continuation });
      case 'sequence':
        return expression.parts.reduceRight((next, part) => lower(part, next), continuation);
      case 'choice': {
        if (expression.alternatives.length === 0) return emit({ kind: 'reject' });
        const entries = expression.alternatives.map((part) => lower(part, continuation));
        let fallback = entries[entries.length - 1];
        for (let index = entries.length - 2; index >= 0; index--) {
          fallback = emit({ kind: 'fork', preferred: entries[index], fallback });
        }
        return fallback;
      }
      case 'repeat': {
        const entry = emit({ kind: 'reject' });
        const body = lower(expression.body, entry);
        instructions[entry] = expression.greedy
          ? { kind: 'fork', preferred: body, fallback: continuation }
          : { kind: 'fork', preferred: continuation, fallback: body };
        return entry;
      }
      case 'capture': {
        const slot = captureSlots.get(expression.name)!;
        const end = emit({ kind: 'save', slot: slot + 1, next: continuation });
        const body = lower(expression.body, end);
        return emit({ kind: 'save', slot, next: body });
      }
    }
  }

  declareCaptures(expression);
  const entry = lower(expression, emit({ kind: 'accept' }));
  return { entry, instructions, captures: [...captureSlots.keys()] };
}
