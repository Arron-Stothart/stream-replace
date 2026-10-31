import { scalar } from './alphabet.js';
import type { Graph } from './graph.js';
import { onward } from './onward.js';
import type { Program } from './program.js';
import { selection, type Mark } from './selection.js';

export function project(
  selected: Graph<Mark>,
  replacement: readonly number[],
): Graph<number> {
  if (replacement.some((value) => !scalar(value)))
    throw new RangeError('Replacement contains an invalid Unicode scalar');
  const output = (marks: readonly Mark[]): number[] =>
    marks.flatMap((mark) => (mark.kind === 'open' ? replacement : []));
  return onward({
    initial: selected.initial.map((initial) => ({
      node: initial.node,
      output: output(initial.output),
    })),
    nodes: selected.nodes.map((node) => ({
      final: node.final,
      edges: node.edges.map((edge) => ({
        ...edge,
        output: output(edge.output),
      })),
    })),
  });
}

export const transducer = (
  program: Program<number>,
  replacement: readonly number[],
): Graph<number> => project(selection(program), replacement);
