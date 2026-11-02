export type Range = readonly [number, number];

export const MAX_CODE_POINT = 0x10ffff;

export const width = (codePoint: number): number =>
  codePoint > 0xffff ? 2 : 1;

export const isHighSurrogate = (unit: number): boolean =>
  unit >= 0xd800 && unit <= 0xdbff;

export const isLowSurrogate = (unit: number): boolean =>
  unit >= 0xdc00 && unit <= 0xdfff;

export const combineSurrogates = (high: number, low: number): number =>
  0x10000 + ((high - 0xd800) << 10) + low - 0xdc00;

export function lastAtOrBelow(
  values: ArrayLike<number>,
  value: number,
  from = 0,
): number {
  let low = from - 1;
  let high = values.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (values[middle] <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

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
      throw new RangeError(
        'Bug in stream-replace: a character range is out of bounds.',
      );
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

export type Boundary =
  | { readonly kind: 'start' | 'end' | 'line-start' | 'line-end' }
  | {
      readonly kind: 'word';
      readonly negated: boolean;
      readonly word: readonly Range[];
    };

export const wordCharacters: readonly Range[] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];

export const digits: readonly Range[] = [[48, 57]];

export const whitespace: readonly Range[] = [
  [9, 13],
  [32, 32],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
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
  previous: number | undefined,
  next: number | undefined,
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

export function holdsWithoutNext(
  boundary: Boundary,
  previous: number | undefined,
): boolean | undefined {
  switch (boundary.kind) {
    case 'start':
    case 'line-start':
      return holds(boundary, previous, undefined);
    default:
      return undefined;
  }
}

const properties = new Map<string, readonly Range[]>();

export function property(name: string): readonly Range[] {
  const cached = properties.get(name);
  if (cached !== undefined) return cached;
  const test = new RegExp(`^\\p{${name}}$`, 'u');
  const ranges: Range[] = [];
  let start = -1;
  for (let value = 0; value <= MAX_CODE_POINT + 1; value++) {
    const included =
      value <= MAX_CODE_POINT && test.test(String.fromCodePoint(value));
    if (included && start < 0) start = value;
    if (!included && start >= 0) {
      ranges.push([start, value - 1]);
      start = -1;
    }
  }
  properties.set(name, ranges);
  return ranges;
}

interface FoldClasses {
  readonly members: readonly number[];
  readonly of: ReadonlyMap<number, readonly number[]>;
}

let classes: FoldClasses | undefined;

function foldClasses(): FoldClasses {
  if (classes !== undefined) return classes;
  const parent = new Map<number, number>();
  const find = (value: number): number => {
    let root = value;
    while (parent.has(root) && parent.get(root) !== root)
      root = parent.get(root)!;
    parent.set(value, root);
    return root;
  };
  for (const [low, high] of property('Changes_When_Casemapped'))
    for (let value = low; value <= high; value++) {
      const text = String.fromCodePoint(value);
      for (const mapped of [text.toLowerCase(), text.toUpperCase()]) {
        const other = mapped.codePointAt(0)!;
        if (
          mapped.length === String.fromCodePoint(other).length &&
          other !== value
        )
          parent.set(find(value), find(other));
      }
    }
  const groups = new Map<number, number[]>();
  for (const value of parent.keys()) {
    const root = find(value);
    let group = groups.get(root);
    if (group === undefined) groups.set(root, (group = []));
    group.push(value);
  }
  const of = new Map<number, readonly number[]>();
  for (const group of groups.values())
    for (const value of group) {
      if (of.has(value)) continue;
      const test = new RegExp(`^\\u{${value.toString(16)}}$`, 'iu');
      const members = group
        .filter((other) => test.test(String.fromCodePoint(other)))
        .sort((a, b) => a - b);
      if (members.length > 1)
        for (const member of members) of.set(member, members);
    }
  return (classes = { members: [...of.keys()].sort((a, b) => a - b), of });
}

export function caseFold(values: readonly Range[]): readonly Range[] {
  const { members, of } = foldClasses();
  const added: Range[] = [];
  for (const [low, high] of values) {
    for (
      let index = lastAtOrBelow(members, low - 1) + 1;
      index < members.length && members[index] <= high;
      index++
    )
      for (const equal of of.get(members[index])!)
        if (!contains(values, equal)) added.push([equal, equal]);
  }
  return added.length === 0 ? values : normalize([...values, ...added]);
}
