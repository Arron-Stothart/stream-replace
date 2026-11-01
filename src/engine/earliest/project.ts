import type { Budget, Graph } from './graph.js';
import { onward } from './onward.js';
import type { Mark } from './selection.js';

export interface Shape {
  readonly open: readonly number[];
  readonly inside: boolean;
  readonly close: readonly number[];
}

export function project(
  marks: Graph<Mark>,
  shape: Shape,
  budget: Budget,
): Graph<number> {
  const output = (marked: readonly Mark[]): number[] =>
    marked.flatMap((mark) => (mark === 'open' ? shape.open : shape.close));
  return onward(
    {
      atoms: marks.atoms,
      initial: marks.initial.map(({ node, output: marked }) => ({
        node,
        output: output(marked),
      })),
      nodes: marks.nodes.map((node) => ({
        final: node.final,
        edges: node.edges.map((edges) =>
          edges.map((edge) => ({
            target: edge.target,
            copy: edge.copy || shape.inside,
            output: output(edge.output),
          })),
        ),
      })),
    },
    budget,
  );
}
