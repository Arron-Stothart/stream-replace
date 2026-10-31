import type { Expression } from './expression.ts';

export type Range = readonly [number, number];

export function ranges(values: readonly Range[]): readonly Range[] {
  const result: [number, number][] = [];
  for (const [start, end] of [...values].sort((left, right) => left[0] - right[0])) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 0x10ffff || start > end) {
      throw new RangeError('Invalid code point range');
    }
    const previous = result[result.length - 1];
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

export function complement(values: readonly Range[]): readonly Range[] {
  const result: Range[] = [];
  let start = 0;
  for (const [low, high] of ranges(values)) {
    if (start < low) result.push([start, low - 1]);
    start = high + 1;
  }
  if (start <= 0x10ffff) result.push([start, 0x10ffff]);
  return result;
}

export function contains(values: readonly Range[], value: number): boolean {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value < values[middle][0]) high = middle;
    else if (value > values[middle][1]) low = middle + 1;
    else return true;
  }
  return false;
}

export function codepoints(values: readonly Range[]): Expression<number> {
  const normalized = ranges(values);
  return { kind: 'symbol', accepts: value => contains(normalized, value), ranges: normalized };
}
