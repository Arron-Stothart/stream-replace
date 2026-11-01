import { holds, observed, type Boundary } from '../../syntax/boundary.js';
import { contains, MAX_CODE_POINT, type Range } from '../../syntax/charset.js';
import type { Automaton } from '../../nfa/automaton.js';
import type { Budget } from './graph.js';

export interface Lookahead {
  readonly atoms: readonly Range[];
  readonly futures: number;
  readonly contexts: readonly number[];
  readonly successors: readonly (readonly (readonly number[])[])[];
  accepts(state: number, left: number, future: number): boolean;
}

export function lookahead(automaton: Automaton, budget: Budget): Lookahead {
  const { states } = automaton;
  const width = states.length;
  const cuts = new Set([0, MAX_CODE_POINT + 1]);
  const parents: number[][] = states.map(() => []);
  const boundaries = new Set<Boundary>();
  states.forEach((state, index) => {
    switch (state.kind) {
      case 'consume':
        for (const [low, high] of state.ranges) cuts.add(low).add(high + 1);
        break;
      case 'assert':
        boundaries.add(state.boundary);
        for (const [low, high] of observed(state.boundary))
          cuts.add(low).add(high + 1);
        parents[state.next].push(index);
        break;
      case 'save':
      case 'reset':
        parents[state.next].push(index);
        break;
      case 'choose':
        for (const successor of state.successors)
          parents[successor].push(index);
        break;
    }
  });
  const points = [...cuts].sort((a, b) => a - b);
  const atoms: Range[] = points
    .slice(0, -1)
    .map((low, index) => [low, points[index + 1] - 1]);

  const representatives: (number | undefined)[] = [undefined];
  const profiles = new Map<string, number>();
  const following = [undefined, ...atoms.map(([low]) => low)];
  const contexts = atoms.map(([previous]) => {
    budget.spend(boundaries.size * following.length);
    const profile = [...boundaries]
      .flatMap((boundary) =>
        following.map((next) => (holds(boundary, { previous, next }) ? 1 : 0)),
      )
      .join('');
    let id = profiles.get(profile);
    if (id === undefined) {
      id = representatives.length;
      profiles.set(profile, id);
      representatives.push(previous);
    }
    return id;
  });
  const bit = (left: number, state: number) =>
    1n << BigInt(left * width + state);

  function precede(
    symbol: number | undefined,
    after: bigint,
    context: number,
  ): bigint {
    budget.spend(representatives.length * width);
    const pending: number[] = [];
    representatives.forEach((_, left) =>
      states.forEach((state, index) => {
        if (
          state.kind === 'accept' ||
          (state.kind === 'consume' &&
            symbol !== undefined &&
            contains(state.ranges, symbol) &&
            (after & bit(context, state.next)) !== 0n)
        )
          pending.push(left * width + index);
      }),
    );
    let result = 0n;
    while (pending.length > 0) {
      const index = pending.pop()!;
      const mask = 1n << BigInt(index);
      if ((result & mask) !== 0n) continue;
      result |= mask;
      const left = Math.floor(index / width);
      for (const parent of parents[index % width]) {
        const state = states[parent];
        if (
          state.kind !== 'assert' ||
          holds(state.boundary, {
            previous: representatives[left],
            next: symbol,
          })
        )
          pending.push(left * width + parent);
      }
    }
    return result;
  }

  const futures = [precede(undefined, 0n, 0)];
  const ids = new Map([[futures[0], 0]]);
  const transitions: number[][] = [];
  for (let index = 0; index < futures.length; index++)
    transitions[index] = atoms.map(([symbol], atom) => {
      const reachable = precede(symbol, futures[index], contexts[atom]);
      let id = ids.get(reachable);
      if (id === undefined) {
        id = futures.length;
        ids.set(reachable, id);
        futures.push(reachable);
      }
      return id;
    });
  const successors: number[][][] = futures.map(() => atoms.map(() => []));
  transitions.forEach((row, after) =>
    row.forEach((before, atom) => successors[before][atom].push(after)),
  );
  return {
    atoms,
    contexts,
    futures: futures.length,
    successors,
    accepts: (state, left, future) =>
      (futures[future] & bit(left, state)) !== 0n,
  };
}
