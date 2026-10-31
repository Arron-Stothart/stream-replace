import { label, type Edge, type Graph } from './graph.js';

function common(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[length] === right[length]
  )
    length++;
  return left.slice(0, length);
}

export function prefixes(graph: Graph<number>): readonly (readonly number[])[] {
  const incoming: { source: number; edge: Edge<number> }[][] = graph.nodes.map(
    () => [],
  );
  graph.nodes.forEach((source, index) => {
    for (const edge of source.edges)
      incoming[edge.target].push({ source: index, edge });
  });
  const result: (readonly number[])[] = graph.nodes.map(() => []);
  const known = new Set<number>();
  const pending: number[] = [];
  graph.nodes.forEach((node, index) => {
    if (node.final) {
      known.add(index);
      pending.push(index);
    }
  });
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const target = pending[cursor];
    for (const { source, edge } of incoming[target]) {
      if (known.has(source)) continue;
      known.add(source);
      result[source] = [...label(edge), ...result[target]];
      pending.push(source);
    }
  }
  if (known.size !== graph.nodes.length)
    throw new Error('Unproductive replacement state');

  const queued = new Set(graph.nodes.map((_, index) => index));
  const work = [...queued];
  while (work.length > 0) {
    const index = work.pop()!;
    queued.delete(index);
    let prefix = result[index];
    for (const edge of graph.nodes[index].edges) {
      prefix = common(prefix, [...label(edge), ...result[edge.target]]);
      if (edge.copy && edge.range[0] !== edge.range[1]) {
        prefix = common(prefix, [
          ...label(edge, edge.range[0] + 1),
          ...result[edge.target],
        ]);
      }
    }
    if (prefix.length === result[index].length) continue;
    result[index] = prefix;
    for (const { source } of incoming[index]) {
      if (!queued.has(source)) {
        queued.add(source);
        work.push(source);
      }
    }
  }
  return result;
}

export function onward(graph: Graph<number>): Graph<number> {
  const prefix = prefixes(graph);
  return {
    initial: graph.initial.map((initial) => ({
      node: initial.node,
      output: [...initial.output, ...prefix[initial.node]],
    })),
    nodes: graph.nodes.map((node, index) => ({
      final: node.final,
      edges: node.edges.map((edge) => {
        const copy = edge.copy && prefix[index].length === 0;
        const output = copy
          ? [...edge.output, ...prefix[edge.target]]
          : [...label(edge), ...prefix[edge.target]].slice(
              prefix[index].length,
            );
        return { ...edge, copy, output };
      }),
    })),
  };
}
