import type { Found } from '../engine/scanner.js';

export interface Match {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (string | undefined)[];
  readonly groups: Readonly<Record<string, string | undefined>> | undefined;
}

export type Segment =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly start: number;
      readonly end: number;
    }
  | ({ readonly kind: 'match' } & Match);

export function toMatch(
  found: Found,
  names: readonly (string | null)[],
): Match {
  let groups: Record<string, string | undefined> | undefined;
  names.forEach((name, index) => {
    if (name !== null) (groups ??= {})[name] = found.captures[index];
  });
  return {
    text: found.text,
    start: found.start,
    end: found.end,
    captures: found.captures,
    groups,
  };
}
