export interface TextMatch {
  readonly text: string;
  readonly groups: readonly (string | undefined)[];
  readonly captures: ReadonlyMap<string, string | undefined>;
  readonly start: number;
  readonly end: number;
}

export type TextReplacement =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'callback'; readonly apply: (match: TextMatch) => string };

export const literal = (
  value: string,
): Extract<TextReplacement, { kind: 'literal' }> => ({
  kind: 'literal',
  value,
});
export const template = (
  source: string,
): Extract<TextReplacement, { kind: 'template' }> => ({
  kind: 'template',
  source,
});
export const mapMatch = (
  apply: (match: TextMatch) => string,
): Extract<TextReplacement, { kind: 'callback' }> => ({
  kind: 'callback',
  apply,
});
