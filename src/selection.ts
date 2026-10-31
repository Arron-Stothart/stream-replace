import { contains } from './alphabet.js';
import type { Edge, Graph } from './graph.js';
import { lookahead } from './lookahead.js';
import { machine } from './machine.js';
import type { Program } from './program.js';

export type Mark =
  | { readonly kind: 'open' }
  | { readonly kind: 'save'; readonly slot: number }
  | { readonly kind: 'close' };

const open: Mark = { kind: 'open' };
const close: Mark = { kind: 'close' };

export function selection(program: Program<number>): Graph<Mark> {
  const threads = machine(program);
  const { entry, steps } = threads;
  const future = lookahead(threads);
  const nodes: {
    thread: number | null;
    right: number;
    final: boolean;
    edges: Edge<Mark>[];
  }[] = [];
  const ids = new Map<string, number>();

  function node(thread: number | null, right: number): number {
    const key = `${thread}:${right}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = nodes.length;
      ids.set(key, id);
      nodes.push({
        thread,
        right,
        final: thread === null && right === 0,
        edges: [],
      });
    }
    return id;
  }

  function settle(
    thread: number | null,
    right: number,
    left: number,
  ): { node: number; output: Mark[] } {
    const output: Mark[] = [];
    while (true) {
      if (thread === null) {
        if (!future.accepts(entry, left, right))
          return { node: node(null, right), output };
        output.push(open);
        thread = entry;
      }
      const step = steps[thread];
      switch (step.kind) {
        case 'accept':
          output.push(close);
          if (!step.progressed) return { node: node(null, right), output };
          thread = null;
          break;
        case 'consume':
          return { node: node(thread, right), output };
        case 'save':
          output.push({ kind: 'save', slot: step.slot });
          thread = step.next;
          break;
        case 'assert':
          thread = step.next;
          break;
        case 'choose': {
          const viable = step.successors.find((successor) =>
            future.accepts(successor, left, right),
          );
          if (viable === undefined)
            throw new Error('Unreachable rejecting path');
          thread = viable;
          break;
        }
      }
    }
  }

  const initial = Array.from({ length: future.states }, (_, right) =>
    settle(null, right, 0),
  );
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    const step = source.thread === null ? null : steps[source.thread];
    if (step !== null && step.kind !== 'consume')
      throw new Error('Unsettled selection state');
    future.alphabet.forEach((range, atom) => {
      if (step !== null && !contains(step.ranges!, range[0])) return;
      for (const right of future.successors[source.right][atom]) {
        const target = settle(
          step === null ? null : step.next,
          right,
          future.contexts[atom],
        );
        source.edges.push({
          range,
          target: target.node,
          output: target.output,
          copy: step === null,
        });
      }
    });
  }
  return { nodes, initial };
}
