import type { Expression } from './expression.ts';

export type Boundary = 'start' | 'end' | 'line-start' | 'line-end' | 'word' | 'not-word';

export interface Context<Symbol> {
  readonly position: number;
  readonly previous: Symbol | undefined;
  readonly next: Symbol | undefined;
  readonly hasNext: boolean;
  readonly ended: boolean;
}

export function category(symbol: number): number {
  if (symbol >= 48 && symbol <= 57 || symbol >= 65 && symbol <= 90 || symbol >= 97 && symbol <= 122 || symbol === 95) return 1;
  if (symbol === 10 || symbol === 13 || symbol === 0x2028 || symbol === 0x2029) return 2;
  return 3;
}

export function boundary(kind: Boundary): Expression<number> {
  return {
    kind: 'assert', boundary: kind,
    accepts: context => {
      const left = context.position === 0 ? 0 : category(context.previous!);
      if (kind === 'start') return left === 0;
      if (kind === 'line-start') return left === 0 || left === 2;
      if (!context.hasNext && !context.ended) return undefined;
      const right = context.hasNext ? category(context.next!) : 0;
      if (kind === 'end') return right === 0;
      if (kind === 'line-end') return right === 0 || right === 2;
      const different = (left === 1) !== (right === 1);
      return kind === 'word' ? different : !different;
    },
  };
}
