import { contains, scalar } from './alphabet.js';
import type { Edge, Graph } from './graph.js';
import { lookahead } from './lookahead.js';
import { machine } from './machine.js';
import { onward } from './onward.js';
import type { Program } from './program.js';

export function transducer(
  program: Program<number>,
  replacement: readonly number[],
): Graph {
  if (replacement.some((value) => !scalar(value)))
    throw new RangeError('Replacement contains an invalid Unicode scalar');
  const threads = machine(program);
  const { entry, steps } = threads;
  const future = lookahead(threads);
  const nodes: {
    thread: number | null;
    right: number;
    final: boolean;
    edges: Edge[];
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
  ): { node: number; output: number[] } {
    const output: number[] = [];
    while (true) {
      if (thread === null) {
        if (!future.accepts(entry, left, right))
          return { node: node(null, right), output };
        for (const symbol of replacement) output.push(symbol);
        thread = entry;
      }
      const step = steps[thread];
      switch (step.kind) {
        case 'accept':
          if (!step.progressed) return { node: node(null, right), output };
          thread = null;
          break;
        case 'consume':
          return { node: node(thread, right), output };
        case 'assert':
        case 'save':
          thread = step.next;
          break;
        case 'choose': {
          const viable = step.successors.find((successor) =>
            future.accepts(successor, left, right),
          );
          if (viable === undefined)
            throw new Error('Unreachable rejecting replacement path');
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
      throw new Error('Unsettled replacement state');
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
  return onward({ nodes, initial });
}
