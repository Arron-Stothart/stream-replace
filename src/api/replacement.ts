import type { Match } from './match.js';

export type Replacement =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'map'; readonly apply: (match: Match) => string };

export const literal = (value: string): Replacement => ({
  kind: 'literal',
  value,
});

export const template = (source: string): Replacement => ({
  kind: 'template',
  source,
});

export const mapMatch = (apply: (match: Match) => string): Replacement => ({
  kind: 'map',
  apply,
});
