import type { Boundary } from './boundary.js';
import type { Range } from './charset.js';

export type Expression =
  | { readonly kind: 'empty' }
  | { readonly kind: 'chars'; readonly ranges: readonly Range[] }
  | { readonly kind: 'assert'; readonly boundary: Boundary }
  | { readonly kind: 'sequence'; readonly parts: readonly Expression[] }
  | { readonly kind: 'choice'; readonly alternatives: readonly Expression[] }
  | {
      readonly kind: 'repeat';
      readonly body: Expression;
      readonly minimum: number;
      readonly maximum: number;
      readonly greedy: boolean;
    }
  | {
      readonly kind: 'capture';
      readonly name: string;
      readonly body: Expression;
    };
