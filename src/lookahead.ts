import { contains, type Range } from './alphabet.js';
import { thread, threadInstruction, threads, type Program } from './program.js';

export interface Lookahead {
  readonly alphabet: readonly Range[];
  readonly states: number;
  readonly contexts: readonly number[];
  readonly successors: readonly (readonly (readonly number[])[])[];
  accepts(
    instruction: number,
    progressed: boolean,
    left: number,
    right: number,
  ): boolean;
}

export function lookahead(program: Program<number>): Lookahead {
  const boundaries = new Set([0, 0xd800, 0xe000, 0x110000]);
  const width = threads(program);
  const parents: number[][] = Array.from({ length: width }, () => []);
  const assertions = program.instructions.filter(
    (instruction) => instruction.kind === 'assert',
  );
  program.instructions.forEach((instruction, index) => {
    if (instruction.kind === 'consume' || instruction.kind === 'assert') {
      if (
        instruction.ranges === undefined ||
        (instruction.kind === 'assert' && instruction.boundary === undefined)
      ) {
        throw new TypeError(
          'Exact emission requires declarative character sets and boundaries',
        );
      }
      for (const [low, high] of instruction.ranges) {
        boundaries.add(low);
        boundaries.add(high + 1);
      }
    }
    for (const progressed of [false, true]) {
      const source = thread(index, progressed);
      switch (instruction.kind) {
        case 'fork':
          parents[thread(instruction.preferred, progressed)].push(source);
          parents[thread(instruction.fallback, progressed)].push(source);
          break;
        case 'save':
        case 'assert':
          parents[thread(instruction.next, progressed)].push(source);
          break;
        case 'iterate':
          parents[thread(instruction.next, false)].push(source);
          break;
        case 'progress':
          if (progressed) parents[thread(instruction.next, true)].push(source);
          break;
      }
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
          assertion.accepts({
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
    function enabled(index: number, left: number): boolean {
      const instruction = program.instructions[index];
      return (
        instruction.kind !== 'assert' ||
        instruction.accepts({
          position: left === 0 ? 0 : 1,
          previous: representatives[left],
          next: symbol,
          hasNext: symbol !== undefined,
          ended: symbol === undefined,
        }) === true
      );
    }
    representatives.forEach((_, left) =>
      program.instructions.forEach((instruction, index) => {
        if (
          instruction.kind === 'accept' ||
          (instruction.kind === 'consume' &&
            symbol !== undefined &&
            contains(instruction.ranges!, symbol) &&
            (suffix & bits[next * width + thread(instruction.next, true)]) !==
              0n)
        )
          pending.push(
            left * width + thread(index, false),
            left * width + thread(index, true),
          );
      }),
    );
    let result = 0n;
    while (pending.length > 0) {
      const index = pending.pop()!;
      if ((result & bits[index]) !== 0n) continue;
      result |= bits[index];
      const left = Math.floor(index / width);
      for (const parent of parents[index % width])
        if (enabled(threadInstruction(parent), left))
          pending.push(left * width + parent);
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
    accepts: (instruction, progressed, left, context) =>
      (right[context] &
        bits[left * width + thread(instruction, progressed)]) !==
      0n,
  };
}
