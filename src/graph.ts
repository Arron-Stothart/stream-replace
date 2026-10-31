import type { Range } from './alphabet.js';

export interface Edge<Value> {
  readonly range: Range;
  readonly target: number;
  readonly output: readonly Value[];
  readonly copy: boolean;
}

export interface Node<Value> {
  readonly final: boolean;
  readonly edges: readonly Edge<Value>[];
}

export interface Graph<Value> {
  readonly nodes: readonly Node<Value>[];
  readonly initial: readonly {
    readonly node: number;
    readonly output: readonly Value[];
  }[];
}

export const label = (
  edge: Edge<number>,
  symbol = edge.range[0],
): readonly number[] => (edge.copy ? [symbol, ...edge.output] : edge.output);
