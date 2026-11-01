import type { Automaton } from '../../nfa/automaton.js';
import { contains } from '../../syntax/charset.js';
import type { Budget } from './budget.js';
import type { Edge, Graph } from './graph.js';
import { futures as analyse } from './futures.js';

export type Mark = 'open' | 'close';

export function markMatches(automaton: Automaton, budget: Budget): Graph<Mark> {
  const { entry, states } = automaton;
  const future = analyse(automaton, budget);
  const nodes: {
    state: number | null;
    future: number;
    final: boolean;
    edges: Edge<Mark>[][];
  }[] = [];
  const ids = new Map<number, number>();

  function node(state: number | null, guess: number): number {
    const key = (state === null ? 0 : state + 1) * future.count + guess;
    let id = ids.get(key);
    if (id === undefined) {
      budget.spend(future.atoms.length);
      id =
        nodes.push({
          state,
          future: guess,
          final: state === null && guess === 0,
          edges: future.atoms.map(() => []),
        }) - 1;
      ids.set(key, id);
    }
    return id;
  }

  function settle(
    state: number | null,
    guess: number,
    left: number,
  ): { node: number; output: Mark[] } {
    const output: Mark[] = [];
    while (true) {
      if (state === null) {
        if (!future.accepts(entry, left, guess))
          return { node: node(null, guess), output };
        output.push('open');
        state = entry;
      }
      const current = states[state];
      switch (current.kind) {
        case 'accept':
          output.push('close');
          if (!current.progressed) return { node: node(null, guess), output };
          state = null;
          break;
        case 'consume':
          return { node: node(state, guess), output };
        case 'assert':
        case 'save':
        case 'reset':
          state = current.next;
          break;
        case 'choose': {
          const viable = current.successors.find((successor) =>
            future.accepts(successor, left, guess),
          );
          if (viable === undefined)
            throw new Error(
              'Internal error: a settled path reached a dead end',
            );
          state = viable;
          break;
        }
      }
    }
  }

  const initial = Array.from({ length: future.count }, (_, guess) =>
    settle(null, guess, 0),
  );
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    const current = source.state === null ? null : states[source.state];
    if (current !== null && current.kind !== 'consume')
      throw new Error('Internal error: an unsettled node');
    future.atoms.forEach((range, atom) => {
      if (current !== null && !contains(current.ranges, range[0])) return;
      for (const guess of future.successors[source.future][atom]) {
        budget.spend(1);
        const target = settle(
          current === null ? null : current.next,
          guess,
          future.contexts[atom],
        );
        source.edges[atom].push({
          target: target.node,
          output: target.output,
          copy: current === null,
        });
      }
    });
  }
  return { atoms: future.atoms, nodes, initial };
}
