import type { TextMatch } from './text.js';

export type TextReplacement =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'callback'; readonly apply: (match: TextMatch) => string };

export const literal = (value: string): TextReplacement => ({
  kind: 'literal',
  value,
});
export const template = (source: string): TextReplacement => ({
  kind: 'template',
  source,
});
export const mapMatch = (
  apply: (match: TextMatch) => string,
): TextReplacement => ({ kind: 'callback', apply });
