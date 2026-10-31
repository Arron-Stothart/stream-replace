import { contains, scalar } from './alphabet.js';
import type { Edge, Graph } from './graph.js';
import { lookahead } from './lookahead.js';
import { onward } from './onward.js';
import type { Program } from './program.js';

export type Transducer = Graph;

export function transducer(
  program: Program<number>,
  replacement: readonly number[],
): Transducer {
  if (replacement.some((value) => !scalar(value)))
    throw new RangeError('Replacement contains an invalid Unicode scalar');
  const future = lookahead(program);
  const nodes: {
    instruction: number | null;
    right: number;
    final: boolean;
    edges: Edge[];
  }[] = [];
  const ids = new Map<string, number>();

  function node(instruction: number | null, right: number): number {
    const key = `${instruction}:${right}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = nodes.length;
      ids.set(key, id);
      nodes.push({
        instruction,
        right,
        final: instruction === null && right === 0,
        edges: [],
      });
    }
    return id;
  }

  function settle(
    instruction: number | null,
    progressed: boolean,
    right: number,
    left: number,
  ): { node: number; output: number[] } {
    const output: number[] = [];
    while (true) {
      if (instruction === null) {
        if (!future.accepts(program.entry, false, left, right))
          return { node: node(null, right), output };
        for (const symbol of replacement) output.push(symbol);
        instruction = program.entry;
        progressed = false;
      }
      const operation = program.instructions[instruction];
      switch (operation.kind) {
        case 'accept':
          if (!progressed) return { node: node(null, right), output };
          instruction = null;
          break;
        case 'reject':
          throw new Error('Unreachable rejecting replacement path');
        case 'consume':
          return { node: node(instruction, right), output };
        case 'assert':
        case 'save':
          instruction = operation.next;
          break;
        case 'iterate':
          instruction = operation.next;
          progressed = false;
          break;
        case 'progress':
          if (!progressed)
            throw new Error('Unreachable rejecting replacement path');
          instruction = operation.next;
          break;
        case 'fork':
          instruction = future.accepts(
            operation.preferred,
            progressed,
            left,
            right,
          )
            ? operation.preferred
            : operation.fallback;
          break;
      }
    }
  }

  const initial = Array.from({ length: future.states }, (_, right) =>
    settle(null, false, right, 0),
  );
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    const operation =
      source.instruction === null
        ? null
        : program.instructions[source.instruction];
    if (operation !== null && operation.kind !== 'consume')
      throw new Error('Unsettled replacement state');
    future.alphabet.forEach((range, atom) => {
      if (operation !== null && !contains(operation.ranges!, range[0])) return;
      for (const right of future.successors[source.right][atom]) {
        const target = settle(
          operation === null ? null : operation.next,
          operation !== null,
          right,
          future.contexts[atom],
        );
        source.edges.push({
          range,
          target: target.node,
          output: target.output,
          copy: operation === null,
        });
      }
    });
  }
  return onward({ nodes, initial });
}
