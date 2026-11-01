import type { Budget } from './budget.js';
import type { Graph } from './graph.js';
import { onward } from './onward.js';
import type { Mark } from './marks.js';
import type { Projection } from '../projection.js';

export function project(
  marks: Graph<Mark>,
  { open, inside, close }: Projection,
  budget: Budget,
): Graph<number> {
  const codePoints = (text: string) =>
    Array.from(text, (character) => character.codePointAt(0)!);
  const opening = codePoints(open);
  const closing = codePoints(close);
  const output = (marked: readonly Mark[]): number[] =>
    marked.flatMap((mark) => (mark === 'open' ? opening : closing));
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
            copy: edge.copy || inside,
            output: output(edge.output),
          })),
        ),
      })),
    },
    budget,
  );
}
