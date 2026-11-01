import type { Boundary } from '../syntax/boundary.js';
import type { Range } from '../syntax/charset.js';

export type Step =
  | {
      readonly kind: 'consume';
      readonly ranges: readonly Range[];
      readonly next: number;
    }
  | {
      readonly kind: 'assert';
      readonly boundary: Boundary;
      readonly next: number;
    }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number }
  | {
      readonly kind: 'reset';
      readonly from: number;
      readonly to: number;
      readonly next: number;
    };

export type Instruction =
  | Step
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | {
      readonly kind: 'fork';
      readonly preferred: number;
      readonly fallback: number;
    }
  | { readonly kind: 'iterate'; readonly next: number }
  | { readonly kind: 'progress'; readonly next: number };

export interface Program {
  readonly entry: number;
  readonly instructions: readonly Instruction[];
  readonly captures: readonly (string | null)[];
}
