import { contains, ranges, scalar, type Range } from './alphabet.js';
import {
  holds,
  observed,
  wordCharacters,
  type Boundary,
  type Context,
} from './boundary.js';

export type Expression<Symbol> =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'assert';
      readonly accepts: (context: Context<Symbol>) => boolean | undefined;
      readonly boundary?: Boundary;
      readonly ranges?: readonly (readonly [number, number])[];
    }
  | {
      readonly kind: 'quantify';
      readonly body: Expression<Symbol>;
      readonly minimum: number;
      readonly maximum: number;
      readonly greedy: boolean;
    }
  | {
      readonly kind: 'symbol';
      readonly accepts: (symbol: Symbol) => boolean;
      readonly ranges?: readonly (readonly [number, number])[];
    }
  | { readonly kind: 'sequence'; readonly parts: readonly Expression<Symbol>[] }
  | {
      readonly kind: 'choice';
      readonly alternatives: readonly Expression<Symbol>[];
    }
  | {
      readonly kind: 'repeat';
      readonly body: Expression<Symbol>;
      readonly greedy: boolean;
    }
  | {
      readonly kind: 'capture';
      readonly name: string;
      readonly body: Expression<Symbol>;
    };

export const empty = <Symbol>(): Expression<Symbol> => ({ kind: 'empty' });

export const symbol = <Symbol>(
  accepts: (symbol: Symbol) => boolean,
): Expression<Symbol> => ({
  kind: 'symbol',
  accepts,
});

export const sequence = <Symbol>(
  ...parts: Expression<Symbol>[]
): Expression<Symbol> => ({
  kind: 'sequence',
  parts,
});

export const choice = <Symbol>(
  ...alternatives: Expression<Symbol>[]
): Expression<Symbol> => ({
  kind: 'choice',
  alternatives,
});

export const repeat = <Symbol>(
  body: Expression<Symbol>,
  greedy = true,
): Expression<Symbol> => ({
  kind: 'repeat',
  body,
  greedy,
});

export const capture = <Symbol>(
  name: string,
  body: Expression<Symbol>,
): Expression<Symbol> => ({
  kind: 'capture',
  name,
  body,
});

export function quantify<Symbol>(
  body: Expression<Symbol>,
  minimum: number,
  maximum = minimum,
  greedy = true,
): Expression<Symbol> {
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    (maximum !== Infinity && !Number.isSafeInteger(maximum)) ||
    maximum < minimum
  ) {
    throw new RangeError('Invalid repetition bounds');
  }
  return { kind: 'quantify', body, minimum, maximum, greedy };
}

export function codepoints(values: readonly Range[]): Expression<number> {
  const normalized = ranges(values);
  return {
    kind: 'symbol',
    accepts: (value) => scalar(value) && contains(normalized, value),
    ranges: normalized,
  };
}

export const boundary = (
  kind: Boundary,
  word: readonly Range[] = wordCharacters,
): Expression<number> => ({
  kind: 'assert',
  boundary: kind,
  ranges: observed(kind, word),
  accepts: (context) => holds(kind, word, context),
});
