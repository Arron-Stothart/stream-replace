export type Range = readonly [number, number];

export const scalar = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0x10ffff &&
  (value < 0xd800 || value > 0xdfff);

export function ranges(values: readonly Range[]): readonly Range[] {
  const result: [number, number][] = [];
  for (const [start, end] of [...values].sort(
    (left, right) => left[0] - right[0],
  )) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 0x10ffff ||
      start > end
    ) {
      throw new RangeError('Invalid code point range');
    }
    const previous = result[result.length - 1];
    if (previous && start <= previous[1] + 1)
      previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result.flatMap(([start, end]): Range[] => {
    if (end < 0xd800 || start > 0xdfff) return [[start, end]];
    const parts: Range[] = [];
    if (start < 0xd800) parts.push([start, 0xd7ff]);
    if (end > 0xdfff) parts.push([0xe000, end]);
    return parts;
  });
}

export function complement(values: readonly Range[]): readonly Range[] {
  const result: Range[] = [];
  let start = 0;
  for (const [low, high] of ranges(values)) {
    if (start < low) result.push([start, low - 1]);
    start = high + 1;
  }
  if (start <= 0x10ffff) result.push([start, 0x10ffff]);
  return ranges(result);
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
