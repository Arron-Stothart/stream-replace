export type Range = readonly [number, number];

export const MAX_CODE_POINT = 0x10ffff;

export function normalize(values: readonly Range[]): readonly Range[] {
  const result: [number, number][] = [];
  for (const [start, end] of [...values].sort((a, b) => a[0] - b[0])) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > MAX_CODE_POINT ||
      start > end
    )
      throw new RangeError('Invalid code point range');
    const previous = result[result.length - 1];
    if (previous && start <= previous[1] + 1)
      previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

export function complement(values: readonly Range[]): readonly Range[] {
  const result: Range[] = [];
  let start = 0;
  for (const [low, high] of normalize(values)) {
    if (start < low) result.push([start, low - 1]);
    start = high + 1;
  }
  if (start <= MAX_CODE_POINT) result.push([start, MAX_CODE_POINT]);
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
