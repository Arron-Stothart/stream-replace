import { contains, MAX_CODE_POINT, normalize, type Range } from './charset.js';

const properties = new Map<string, readonly Range[]>();

export function property(name: string): readonly Range[] {
  let result = properties.get(name);
  if (result !== undefined) return result;
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
  properties.set(name, (result = ranges));
  return result;
}

let classes:
  | {
      readonly members: readonly number[];
      readonly of: ReadonlyMap<number, readonly number[]>;
    }
  | undefined;

function foldClasses(): NonNullable<typeof classes> {
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
    let index = 0;
    let end = members.length;
    while (index < end) {
      const middle = (index + end) >>> 1;
      if (members[middle] < low) index = middle + 1;
      else end = middle;
    }
    for (; index < members.length && members[index] <= high; index++)
      for (const equal of of.get(members[index])!)
        if (!contains(values, equal)) added.push([equal, equal]);
  }
  return added.length === 0 ? values : normalize([...values, ...added]);
}
