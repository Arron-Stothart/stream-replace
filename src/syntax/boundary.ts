import { contains, type Range } from './charset.js';

export type Boundary =
  | { readonly kind: 'start' | 'end' | 'line-start' | 'line-end' }
  | {
      readonly kind: 'word';
      readonly negated: boolean;
      readonly word: readonly Range[];
    };

export interface Context {
  readonly previous: number | undefined;
  readonly next: number | undefined;
}

export const wordCharacters: readonly Range[] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];

export const lineTerminators: readonly Range[] = [
  [10, 10],
  [13, 13],
  [0x2028, 0x2029],
];

const within = (set: readonly Range[], value: number | undefined): boolean =>
  value !== undefined && contains(set, value);

export function holds(
  boundary: Boundary,
  { previous, next }: Context,
): boolean {
  switch (boundary.kind) {
    case 'start':
      return previous === undefined;
    case 'end':
      return next === undefined;
    case 'line-start':
      return previous === undefined || within(lineTerminators, previous);
    case 'line-end':
      return next === undefined || within(lineTerminators, next);
    case 'word':
      return (
        (within(boundary.word, previous) !== within(boundary.word, next)) !==
        boundary.negated
      );
  }
}

export function holdsBefore(
  boundary: Boundary,
  previous: number | undefined,
): boolean | undefined {
  switch (boundary.kind) {
    case 'start':
    case 'line-start':
      return holds(boundary, { previous, next: undefined });
    default:
      return undefined;
  }
}

export function observed(boundary: Boundary): readonly Range[] {
  switch (boundary.kind) {
    case 'start':
    case 'end':
      return [];
    case 'line-start':
    case 'line-end':
      return lineTerminators;
    case 'word':
      return boundary.word;
  }
}
