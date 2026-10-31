import type { Boundary, Context } from './boundary.ts';

export interface Acceptance {
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (number | null)[];
}

export type Instruction<Symbol> =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'assert'; readonly accepts: (context: Context<Symbol>) => boolean | undefined; readonly boundary?: Boundary; readonly next: number }
  | { readonly kind: 'consume'; readonly accepts: (symbol: Symbol) => boolean; readonly next: number; readonly ranges?: readonly (readonly [number, number])[] }
  | { readonly kind: 'fork'; readonly preferred: number; readonly fallback: number }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number };

export interface Program<Symbol> {
  readonly entry: number;
  readonly instructions: readonly Instruction<Symbol>[];
  readonly captures: readonly string[];
}
