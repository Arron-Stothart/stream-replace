import type { Range } from './alphabet.js';

export interface Edge {
  readonly range: Range;
  readonly target: number;
  readonly output: readonly number[];
  readonly copy: boolean;
}

export interface Node {
  readonly final: boolean;
  readonly edges: readonly Edge[];
}

export interface Graph {
  readonly nodes: readonly Node[];
  readonly initial: readonly {
    readonly node: number;
    readonly output: readonly number[];
  }[];
}

export const label = (edge: Edge, symbol = edge.range[0]): readonly number[] =>
  edge.copy ? [symbol, ...edge.output] : edge.output;
