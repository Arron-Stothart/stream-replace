import { contains, type Range } from './alphabet.js';
import type { Machine } from './machine.js';

export interface Lookahead {
  readonly alphabet: readonly Range[];
  readonly states: number;
  readonly contexts: readonly number[];
  readonly successors: readonly (readonly (readonly number[])[])[];
  accepts(thread: number, left: number, right: number): boolean;
}

export function lookahead(machine: Machine<number>): Lookahead {
  const boundaries = new Set([0, 0xd800, 0xe000, 0x110000]);
  const width = machine.steps.length;
  const parents: number[][] = machine.steps.map(() => []);
  const assertions = [
    ...new Set(
      machine.steps.flatMap((step) =>
        step.kind === 'assert' ? [step.accepts] : [],
      ),
    ),
  ];
  machine.steps.forEach((step, thread) => {
    switch (step.kind) {
      case 'consume':
      case 'assert':
        if (
          step.ranges === undefined ||
          (step.kind === 'assert' && step.boundary === undefined)
        ) {
          throw new TypeError(
            'Exact emission requires declarative character sets and boundaries',
          );
        }
        for (const [low, high] of step.ranges) {
          boundaries.add(low);
          boundaries.add(high + 1);
        }
        if (step.kind === 'assert') parents[step.next].push(thread);
        break;
      case 'save':
        parents[step.next].push(thread);
        break;
      case 'choose':
        for (const successor of step.successors)
          parents[successor].push(thread);
        break;
    }
  });
  const points = [...boundaries].sort((a, b) => a - b);
  const alphabet: Range[] = points
    .slice(0, -1)
    .map((low, index): Range => [low, points[index + 1] - 1])
    .filter(([low]) => low < 0xd800 || low > 0xdfff);
  const representatives: (number | undefined)[] = [undefined];
  const profiles = new Map<string, number>();
  const following = [undefined, ...alphabet.map(([low]) => low)];
  const contexts = alphabet.map(([previous]) => {
    const profile = assertions
      .flatMap((assertion) =>
        following.map((next) =>
          assertion({
            position: 1,
            previous,
            next,
            hasNext: next !== undefined,
            ended: next === undefined,
          }),
        ),
      )
      .join(',');
    let id = profiles.get(profile);
    if (id === undefined) {
      id = representatives.length;
      profiles.set(profile, id);
      representatives.push(previous);
    }
    return id;
  });
  const bits = Array.from(
    { length: width * representatives.length },
    (_, index) => 1n << BigInt(index),
  );

  function precede(
    symbol: number | undefined,
    suffix: bigint,
    next: number,
  ): bigint {
    const pending: number[] = [];
    function enabled(thread: number, left: number): boolean {
      const step = machine.steps[thread];
      return (
        step.kind !== 'assert' ||
        step.accepts({
          position: left === 0 ? 0 : 1,
          previous: representatives[left],
          next: symbol,
          hasNext: symbol !== undefined,
          ended: symbol === undefined,
        }) === true
      );
    }
    representatives.forEach((_, left) =>
      machine.steps.forEach((step, thread) => {
        if (
          step.kind === 'accept' ||
          (step.kind === 'consume' &&
            symbol !== undefined &&
            contains(step.ranges!, symbol) &&
            (suffix & bits[next * width + step.next]) !== 0n)
        )
          pending.push(left * width + thread);
      }),
    );
    let result = 0n;
    while (pending.length > 0) {
      const index = pending.pop()!;
      if ((result & bits[index]) !== 0n) continue;
      result |= bits[index];
      const left = Math.floor(index / width);
      for (const parent of parents[index % width])
        if (enabled(parent, left)) pending.push(left * width + parent);
    }
    return result;
  }

  const right = [precede(undefined, 0n, 0)];
  const ids = new Map([[right[0], 0]]);
  const transitions: number[][] = [];
  for (let index = 0; index < right.length; index++) {
    transitions[index] = alphabet.map(([symbol], atom) => {
      const reachable = precede(symbol, right[index], contexts[atom]);
      let id = ids.get(reachable);
      if (id === undefined) {
        id = right.length;
        ids.set(reachable, id);
        right.push(reachable);
      }
      return id;
    });
  }
  const successors: number[][][] = right.map(() => alphabet.map(() => []));
  transitions.forEach((row, next) =>
    row.forEach((current, atom) => successors[current][atom].push(next)),
  );
  return {
    alphabet,
    contexts,
    states: right.length,
    successors,
    accepts: (thread, left, context) =>
      (right[context] & bits[left * width + thread]) !== 0n,
  };
}
