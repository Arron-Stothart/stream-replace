import type { Range } from '../../syntax/charset.js';

export interface Edge<Value> {
  readonly target: number;
  readonly output: readonly Value[];
  readonly copy: boolean;
}

export interface Node<Value> {
  readonly final: boolean;
  readonly edges: readonly (readonly Edge<Value>[])[];
}

export interface Graph<Value> {
  readonly atoms: readonly Range[];
  readonly nodes: readonly Node<Value>[];
  readonly initial: readonly {
    readonly node: number;
    readonly output: readonly Value[];
  }[];
}

export const written = (
  edge: Edge<number>,
  symbol: number,
): readonly number[] => (edge.copy ? [symbol, ...edge.output] : edge.output);

export function atomOf(atoms: readonly Range[], symbol: number): number {
  let low = 0;
  let high = atoms.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (atoms[middle][0] <= symbol) low = middle;
    else high = middle - 1;
  }
  return low;
}
