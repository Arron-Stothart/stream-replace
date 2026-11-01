import { scalar } from './alphabet.js';
import type { Graph } from './graph.js';
import { onward } from './onward.js';
import type { Program } from './program.js';
import { selection, type Mark } from './selection.js';

export interface Projection {
  readonly open: readonly number[];
  readonly inside: boolean;
  readonly close: readonly number[];
}

export const literalProjection = (
  replacement: readonly number[],
): Projection => ({
  open: replacement,
  inside: false,
  close: [],
});

export function project(
  selected: Graph<Mark>,
  projection: Projection,
): Graph<number> {
  if ([...projection.open, ...projection.close].some((value) => !scalar(value)))
    throw new RangeError('Replacement contains an invalid Unicode scalar');
  const output = (marks: readonly Mark[]): number[] =>
    marks.flatMap((mark) =>
      mark.kind === 'open'
        ? projection.open
        : mark.kind === 'close'
          ? projection.close
          : [],
    );
  return onward({
    initial: selected.initial.map((initial) => ({
      node: initial.node,
      output: output(initial.output),
    })),
    nodes: selected.nodes.map((node) => ({
      final: node.final,
      edges: node.edges.map((edge) => ({
        ...edge,
        copy: edge.copy || projection.inside,
        output: output(edge.output),
      })),
    })),
  });
}

export const transducer = (
  program: Program<number>,
  replacement: readonly number[],
): Graph<number> => project(selection(program), literalProjection(replacement));
