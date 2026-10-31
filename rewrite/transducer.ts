import { category } from './boundary.ts';
import type { Range } from './alphabet.ts';
import { contains } from './alphabet.ts';
import type { Program } from './program.ts';

export interface Edge {
  readonly range: Range;
  readonly target: number;
  readonly output: readonly number[];
  readonly copy: boolean;
}

export interface Node {
  readonly instruction: number;
  readonly right: number;
  readonly left: number;
  readonly final: boolean;
  readonly edges: Edge[];
  prefix: readonly number[];
}

export interface Transducer {
  readonly nodes: readonly Node[];
  readonly initial: readonly { readonly node: number; readonly output: readonly number[] }[];
}

function common(left: readonly number[], right: readonly number[]): readonly number[] {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length++;
  return left.slice(0, length);
}

export function transducer(program: Program<number>, replacement: readonly number[]): Transducer {
  const boundaries = new Set([0, 10, 11, 13, 14, 48, 58, 65, 91, 95, 96, 97, 123, 0x2028, 0x202a, 0x110000]);
  const parents: number[][] = program.instructions.map(() => []);
  const size = program.instructions.length;
  const bits = Array.from({ length: size * 4 }, (_, index) => 1n << BigInt(index));
  program.instructions.forEach((instruction, index) => {
    if (instruction.kind === 'consume') {
      if (instruction.ranges === undefined) throw new TypeError('Exact emission requires declarative character sets');
      for (const [low, high] of instruction.ranges) {
        boundaries.add(low);
        boundaries.add(high + 1);
      }
    } else if (instruction.kind === 'fork') {
      parents[instruction.preferred].push(index);
      parents[instruction.fallback].push(index);
    } else if (instruction.kind === 'save' || instruction.kind === 'assert') {
      if (instruction.kind === 'assert' && instruction.boundary === undefined) throw new TypeError('Exact emission requires declarative boundaries');
      parents[instruction.next].push(index);
    }
  });
  const points = [...boundaries].sort((a, b) => a - b);
  const alphabet: Range[] = points.slice(0, -1).map((low, index) => [low, points[index + 1] - 1]);

  function precede(symbol: number | null, suffix: bigint): bigint {
    const pending: number[] = [];
    const next = symbol === null ? 0 : category(symbol);
    function enabled(index: number, left: number): boolean {
      const instruction = program.instructions[index];
      return instruction.kind !== 'assert' || instruction.accepts({
        position: left === 0 ? 0 : 1,
        previous: [undefined, 97, 10, 32][left],
        next: symbol ?? undefined,
        hasNext: symbol !== null,
        ended: symbol === null,
      }) === true;
    }
    for (let left = 0; left < 4; left++) program.instructions.forEach((instruction, index) => {
      if (instruction.kind === 'accept' || instruction.kind === 'consume' && symbol !== null
        && contains(instruction.ranges!, symbol) && (suffix & bits[next * size + instruction.next]) !== 0n) pending.push(left * size + index);
    });
    let result = 0n;
    while (pending.length > 0) {
      const index = pending.pop()!;
      if ((result & bits[index]) !== 0n) continue;
      result |= bits[index];
      const left = Math.floor(index / size);
      for (const parent of parents[index % size]) if (enabled(parent, left)) pending.push(left * size + parent);
    }
    return result;
  }

  const right = [precede(null, 0n)];
  const rightIds = new Map([[right[0], 0]]);
  const transitions: number[][] = [];
  for (let index = 0; index < right.length; index++) {
    transitions[index] = alphabet.map(([symbol]) => {
      const state = precede(symbol, right[index]);
      let id = rightIds.get(state);
      if (id === undefined) {
        id = right.length;
        rightIds.set(state, id);
        right.push(state);
      }
      return id;
    });
  }
  const successors: number[][][] = right.map(() => alphabet.map(() => []));
  transitions.forEach((row, next) => row.forEach((current, atom) => successors[current][atom].push(next)));

  const nodes: Node[] = [];
  const nodeIds = new Map<string, number>();
  function node(instruction: number, context: number, left: number): number {
    const key = `${instruction}:${context}:${left}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodeIds.set(key, id);
      nodes.push({ instruction, right: context, left, final: instruction === -1 && context === 0, edges: [], prefix: [] });
    }
    return id;
  }

  function settle(instruction: number, consumed: boolean, context: number, left: number): { node: number; output: number[] } {
    const output: number[] = [];
    while (true) {
      if (instruction === -1) {
        if ((right[context] & bits[left * size + program.entry]) === 0n) return { node: node(-1, context, left), output };
        for (const symbol of replacement) output.push(symbol);
        instruction = program.entry;
        consumed = false;
      }
      const operation = program.instructions[instruction];
      switch (operation.kind) {
        case 'accept':
          if (!consumed) return { node: node(-1, context, left), output };
          instruction = -1;
          break;
        case 'reject':
          throw new Error('Unreachable rejecting transducer path');
        case 'consume':
          return { node: node(instruction, context, left), output };
        case 'assert':
        case 'save':
          instruction = operation.next;
          break;
        case 'fork':
          instruction = (right[context] & bits[left * size + operation.preferred]) !== 0n ? operation.preferred : operation.fallback;
          break;
      }
    }
  }

  const initial = right.map((_, context) => settle(-1, false, context, 0));
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    alphabet.forEach((range, atom) => {
      for (const context of successors[source.right][atom]) {
        const operation = source.instruction === -1 ? null : program.instructions[source.instruction];
        if (operation !== null && operation.kind !== 'consume') throw new Error('Unsettled transducer node');
        if (operation !== null && !contains(operation.ranges!, range[0])) continue;
        const target = settle(operation === null ? -1 : operation.next, operation !== null, context, category(range[0]));
        source.edges.push({ range, target: target.node, output: operation === null ? [range[0], ...target.output] : target.output, copy: operation === null });
      }
    });
  }

  const incoming: { source: number; edge: Edge }[][] = nodes.map(() => []);
  nodes.forEach((source, index) => source.edges.forEach(edge => incoming[edge.target].push({ source: index, edge })));
  const known = new Set<number>();
  const pending: number[] = [];
  nodes.forEach((value, index) => { if (value.final) { known.add(index); pending.push(index); } });
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const target = pending[cursor];
    for (const { source, edge } of incoming[target]) {
      if (known.has(source)) continue;
      known.add(source);
      nodes[source].prefix = [...edge.output, ...nodes[target].prefix];
      pending.push(source);
    }
  }
  if (known.size !== nodes.length) throw new Error('Unproductive transducer node');

  let changed = true;
  while (changed) {
    changed = false;
    for (const source of nodes) {
      if (source.prefix.length === 0) continue;
      let prefix = source.prefix;
      for (const edge of source.edges) {
        prefix = common(prefix, [...edge.output, ...nodes[edge.target].prefix]);
        if (edge.copy && edge.range[0] !== edge.range[1]) {
          prefix = common(prefix, [edge.range[0] + 1, ...edge.output.slice(1), ...nodes[edge.target].prefix]);
        }
      }
      if (prefix.length < source.prefix.length) {
        source.prefix = prefix;
        changed = true;
      }
    }
  }
  return { nodes, initial };
}
