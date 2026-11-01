import { label, type Budget, type Edge, type Graph } from './graph.js';

function commonPrefix(
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

function prefixes(
  graph: Graph<number>,
  budget: Budget,
): readonly (readonly number[])[] {
  const { atoms, nodes } = graph;
  const incoming: { source: number; edge: Edge<number>; symbol: number }[][] =
    nodes.map(() => []);
  const result: (readonly number[])[] = nodes.map(() => []);

  nodes.forEach((node, source) =>
    node.edges.forEach((edges, atom) => {
      for (const edge of edges)
        incoming[edge.target].push({ source, edge, symbol: atoms[atom][0] });
    }),
  );

  const known = new Set<number>();
  const order: number[] = [];
  nodes.forEach((node, index) => {
    if (node.final) {
      known.add(index);
      order.push(index);
    }
  });
  for (let cursor = 0; cursor < order.length; cursor++) {
    const target = order[cursor];
    for (const { source, edge, symbol } of incoming[target]) {
      if (known.has(source)) continue;
      known.add(source);
      result[source] = [...label(edge, symbol), ...result[target]];
      order.push(source);
    }
  }
  if (known.size !== nodes.length)
    throw new Error('A replacement state cannot finish');

  const queued = new Set(nodes.keys());
  const work = [...queued];
  while (work.length > 0) {
    const index = work.pop()!;
    queued.delete(index);
    let prefix = result[index];
    nodes[index].edges.forEach((edges, atom) => {
      const [low, high] = atoms[atom];
      for (const edge of edges) {
        budget.spend(1);
        prefix = commonPrefix(prefix, [
          ...label(edge, low),
          ...result[edge.target],
        ]);
        if (edge.copy && low !== high)
          prefix = commonPrefix(prefix, [
            ...label(edge, low + 1),
            ...result[edge.target],
          ]);
      }
    });
    if (prefix.length === result[index].length) continue;
    result[index] = prefix;
    for (const { source } of incoming[index])
      if (!queued.has(source)) {
        queued.add(source);
        work.push(source);
      }
  }
  return result;
}

export function onward(graph: Graph<number>, budget: Budget): Graph<number> {
  const prefix = prefixes(graph, budget);
  return {
    atoms: graph.atoms,
    initial: graph.initial.map(({ node, output }) => ({
      node,
      output: [...output, ...prefix[node]],
    })),
    nodes: graph.nodes.map((node, index) => ({
      final: node.final,
      edges: node.edges.map((edges, atom) =>
        edges.map((edge) => {
          const copy = edge.copy && prefix[index].length === 0;
          const output = copy
            ? [...edge.output, ...prefix[edge.target]]
            : [
                ...label(edge, graph.atoms[atom][0]),
                ...prefix[edge.target],
              ].slice(prefix[index].length);
          return { target: edge.target, copy, output };
        }),
      ),
    })),
  };
}
