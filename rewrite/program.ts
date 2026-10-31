export type Instruction<Symbol> =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'consume'; readonly accepts: (symbol: Symbol) => boolean; readonly next: number }
  | { readonly kind: 'fork'; readonly preferred: number; readonly fallback: number }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number };

export interface Program<Symbol> {
  readonly entry: number;
  readonly instructions: readonly Instruction<Symbol>[];
  readonly captures: readonly string[];
}
