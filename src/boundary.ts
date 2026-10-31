import { contains, type Range } from './alphabet.js';
import type { Expression } from './expression.js';

export type Boundary =
  | 'start'
  | 'end'
  | 'line-start'
  | 'line-end'
  | 'word'
  | 'not-word';

export interface Context<Symbol> {
  readonly position: number;
  readonly previous: Symbol | undefined;
  readonly next: Symbol | undefined;
  readonly hasNext: boolean;
  readonly ended: boolean;
}

export const wordCharacters: readonly Range[] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];
export const lineCharacters: readonly Range[] = [
  [10, 10],
  [13, 13],
  [0x2028, 0x2029],
];

export function boundary(
  kind: Boundary,
  word = wordCharacters,
): Expression<number> {
  const ranges =
    kind === 'word' || kind === 'not-word'
      ? word
      : kind === 'line-start' || kind === 'line-end'
        ? lineCharacters
        : [];
  return {
    kind: 'assert',
    boundary: kind,
    ranges,
    accepts: (context) => {
      if (kind === 'start') return context.position === 0;
      if (kind === 'line-start')
        return (
          context.position === 0 || contains(lineCharacters, context.previous!)
        );
      if (!context.hasNext && !context.ended) return undefined;
      if (kind === 'end') return context.ended;
      if (kind === 'line-end')
        return context.ended || contains(lineCharacters, context.next!);
      const left = context.position > 0 && contains(word, context.previous!);
      const right = context.hasNext && contains(word, context.next!);
      return kind === 'word' ? left !== right : left === right;
    },
  };
}
