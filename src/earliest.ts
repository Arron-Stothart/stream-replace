import {
  charactersExamined,
  contains,
  holds,
  lastAtOrBelow,
  MAX_CODE_POINT,
  width,
  type Boundary,
  type Range,
} from './alphabet.js';
import type { Automaton } from './automaton.js';
import { TextBuffer } from './text.js';

const BUDGET = 2_000_000;

class TooLarge extends Error {}

type Spend = (cost: number) => void;

function budget(limit: number): Spend {
  let remaining = limit;
  return (cost) => {
    remaining -= cost;
    if (remaining < 0) throw new TooLarge();
  };
}

function withinBudget<Result>(analyse: () => Result): Result | null {
  try {
    return analyse();
  } catch (error) {
    if (error instanceof TooLarge) return null;
    throw error;
  }
}

function intern<Key>(
  ids: Map<Key, number>,
  key: Key,
  create: (id: number) => void,
): number {
  const known = ids.get(key);
  if (known !== undefined) return known;
  const id = ids.size;
  ids.set(key, id);
  create(id);
  return id;
}

type Mark = 'open' | 'close';

interface Edge<Value> {
  readonly target: number;
  readonly output: readonly Value[];
  readonly copy: boolean;
}

interface Node<Value> {
  readonly final: boolean;
  readonly edges: readonly (readonly Edge<Value>[])[];
}

interface Graph<Value> {
  readonly atoms: readonly Range[];
  readonly nodes: readonly Node<Value>[];
  readonly initial: readonly {
    readonly node: number;
    readonly output: readonly Value[];
  }[];
}

const written = (edge: Edge<number>, symbol: number): readonly number[] =>
  edge.copy ? [symbol, ...edge.output] : edge.output;

interface Futures {
  readonly atoms: readonly Range[];
  readonly count: number;
  readonly contexts: readonly number[];
  readonly successors: readonly (readonly (readonly number[])[])[];
  accepts(state: number, context: number, future: number): boolean;
}

function futures(automaton: Automaton, spend: Spend): Futures {
  const { states } = automaton;
  const stateCount = states.length;
  const cuts = new Set([0, MAX_CODE_POINT + 1]);
  const parents: number[][] = states.map(() => []);
  const boundaries = new Set<Boundary>();
  states.forEach((state, index) => {
    switch (state.kind) {
      case 'consume':
        for (const [low, high] of state.ranges) cuts.add(low).add(high + 1);
        break;
      case 'assert':
        boundaries.add(state.boundary);
        for (const [low, high] of charactersExamined(state.boundary))
          cuts.add(low).add(high + 1);
        parents[state.next].push(index);
        break;
      case 'save':
      case 'reset':
        parents[state.next].push(index);
        break;
      case 'choose':
        for (const successor of state.successors)
          parents[successor].push(index);
        break;
    }
  });
  const points = [...cuts].sort((a, b) => a - b);
  const atoms: Range[] = points
    .slice(0, -1)
    .map((low, index) => [low, points[index + 1] - 1]);

  const contextSamples: (number | undefined)[] = [undefined];
  const profiles = new Map<string | null, number>([[null, 0]]);
  const following = [undefined, ...atoms.map(([low]) => low)];
  const contexts = atoms.map(([previous]) => {
    spend(boundaries.size * following.length);
    const profile = [...boundaries]
      .flatMap((boundary) =>
        following.map((next) => (holds(boundary, previous, next) ? 1 : 0)),
      )
      .join('');
    return intern(profiles, profile, () => contextSamples.push(previous));
  });
  const bit = (context: number, state: number) =>
    1n << BigInt(context * stateCount + state);

  function acceptingBefore(
    symbol: number | undefined,
    after: bigint,
    nextContext: number,
  ): bigint {
    spend(contextSamples.length * stateCount);
    const pending: number[] = [];
    contextSamples.forEach((_, context) =>
      states.forEach((state, index) => {
        if (
          state.kind === 'accept' ||
          (state.kind === 'consume' &&
            symbol !== undefined &&
            contains(state.ranges, symbol) &&
            (after & bit(nextContext, state.next)) !== 0n)
        )
          pending.push(context * stateCount + index);
      }),
    );
    let result = 0n;
    while (pending.length > 0) {
      const index = pending.pop()!;
      const mask = 1n << BigInt(index);
      if ((result & mask) !== 0n) continue;
      result |= mask;
      const context = Math.floor(index / stateCount);
      for (const parent of parents[index % stateCount]) {
        const state = states[parent];
        if (
          state.kind !== 'assert' ||
          holds(state.boundary, contextSamples[context], symbol)
        )
          pending.push(context * stateCount + parent);
      }
    }
    return result;
  }

  const sets: bigint[] = [];
  const ids = new Map<bigint, number>();
  const atStart = acceptingBefore(undefined, 0n, 0);
  intern(ids, atStart, () => sets.push(atStart));
  const transitions: number[][] = [];
  for (let index = 0; index < sets.length; index++)
    transitions[index] = atoms.map(([symbol], atom) => {
      const reachable = acceptingBefore(symbol, sets[index], contexts[atom]);
      return intern(ids, reachable, () => sets.push(reachable));
    });
  const successors: number[][][] = sets.map(() => atoms.map(() => []));
  transitions.forEach((row, after) =>
    row.forEach((before, atom) => successors[before][atom].push(after)),
  );
  return {
    atoms,
    contexts,
    count: sets.length,
    successors,
    accepts: (state, context, future) =>
      (sets[future] & bit(context, state)) !== 0n,
  };
}

function markMatches(automaton: Automaton, spend: Spend): Graph<Mark> {
  const { entry, states } = automaton;
  const lookahead = futures(automaton, spend);
  const nodes: {
    state: number | null;
    future: number;
    final: boolean;
    edges: Edge<Mark>[][];
  }[] = [];
  const ids = new Map<number, number>();

  const node = (state: number | null, future: number): number =>
    intern(
      ids,
      (state === null ? 0 : state + 1) * lookahead.count + future,
      () => {
        spend(lookahead.atoms.length);
        nodes.push({
          state,
          future,
          final: state === null && future === 0,
          edges: lookahead.atoms.map(() => []),
        });
      },
    );

  function settle(
    from: number | null,
    future: number,
    context: number,
  ): { node: number; output: Mark[] } {
    const output: Mark[] = [];
    let state = from;
    while (true) {
      if (state === null) {
        if (!lookahead.accepts(entry, context, future))
          return { node: node(null, future), output };
        output.push('open');
        state = entry;
      }
      const current = states[state];
      switch (current.kind) {
        case 'accept':
          output.push('close');
          if (!current.progressed) return { node: node(null, future), output };
          state = null;
          break;
        case 'consume':
          return { node: node(state, future), output };
        case 'assert':
        case 'save':
        case 'reset':
          state = current.next;
          break;
        case 'choose': {
          const viable = current.successors.find((successor) =>
            lookahead.accepts(successor, context, future),
          );
          if (viable === undefined)
            throw new Error(
              'Bug in regex-stream-transform: a replacement path has no way forward.',
            );
          state = viable;
          break;
        }
      }
    }
  }

  const initial = Array.from({ length: lookahead.count }, (_, future) =>
    settle(null, future, 0),
  );
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    const current = source.state === null ? null : states[source.state];
    if (current !== null && current.kind !== 'consume')
      throw new Error(
        'Bug in regex-stream-transform: a replacement step is incomplete.',
      );
    lookahead.atoms.forEach((range, atom) => {
      if (current !== null && !contains(current.ranges, range[0])) return;
      for (const future of lookahead.successors[source.future][atom]) {
        spend(1);
        const target = settle(
          current === null ? null : current.next,
          future,
          lookahead.contexts[atom],
        );
        source.edges[atom].push({
          target: target.node,
          output: target.output,
          copy: current === null,
        });
      }
    });
  }
  return { atoms: lookahead.atoms, nodes, initial };
}

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

function guaranteedOutput(
  graph: Graph<number>,
  spend: Spend,
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
      result[source] = [...written(edge, symbol), ...result[target]];
      order.push(source);
    }
  }
  if (known.size !== nodes.length)
    throw new Error(
      'Bug in regex-stream-transform: a replacement path can never finish.',
    );

  const through = (edge: Edge<number>, symbol: number) => [
    ...written(edge, symbol),
    ...result[edge.target],
  ];
  const queued = new Set(nodes.keys());
  const work = [...queued];
  while (work.length > 0) {
    const index = work.pop()!;
    queued.delete(index);
    let common = result[index];
    nodes[index].edges.forEach((edges, atom) => {
      const [low, high] = atoms[atom];
      for (const edge of edges) {
        spend(1);
        common = commonPrefix(common, through(edge, low));
        const dependsOnSymbol = edge.copy && low !== high;
        if (dependsOnSymbol)
          common = commonPrefix(common, through(edge, low + 1));
      }
    });
    if (common.length === result[index].length) continue;
    result[index] = common;
    for (const { source } of incoming[index])
      if (!queued.has(source)) {
        queued.add(source);
        work.push(source);
      }
  }
  return result;
}

function hoistCommonOutput(graph: Graph<number>, spend: Spend): Graph<number> {
  const prefix = guaranteedOutput(graph, spend);
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
                ...written(edge, graph.atoms[atom][0]),
                ...prefix[edge.target],
              ].slice(prefix[index].length);
          return { target: edge.target, copy, output };
        }),
      ),
    })),
  };
}

interface Wrapping {
  readonly opening: readonly number[];
  readonly copy: boolean;
  readonly closing: readonly number[];
}

const codePoints = (text: string): number[] =>
  Array.from(text, (character) => character.codePointAt(0)!);

function project(
  marks: Graph<Mark>,
  { opening, copy, closing }: Wrapping,
  spend: Spend,
): Graph<number> {
  const output = (marked: readonly Mark[]): number[] =>
    marked.flatMap((mark) => (mark === 'open' ? opening : closing));
  return hoistCommonOutput(
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
            copy: edge.copy || copy,
            output: output(edge.output),
          })),
        ),
      })),
    },
    spend,
  );
}

type Piece =
  | {
      readonly kind: 'copy';
      readonly from: number;
      readonly end: number;
      readonly next: Piece | null;
    }
  | {
      readonly kind: 'literal';
      readonly text: string;
      readonly end: number;
      readonly next: Piece | null;
    };

type Appended =
  | {
      readonly kind: 'copy';
      readonly from: number;
      readonly earlierEnd: number;
      readonly earlier: Appended | null;
    }
  | {
      readonly kind: 'literal';
      readonly text: string;
      readonly earlierEnd: number;
      readonly earlier: Appended | null;
    };

interface Pending {
  readonly front: Piece | null;
  readonly offset: number;
  readonly back: Appended | null;
  readonly backEnd: number;
  readonly floor: number;
}

const pendingOf = (
  front: Piece | null,
  offset: number,
  back: Appended | null,
  backEnd: number,
  floor: number,
): Pending => ({ front, offset, back, backEnd, floor });

const emptyPending = pendingOf(null, 0, null, 0, Infinity);

const startOf = (piece: Piece): number =>
  piece.kind === 'copy' ? piece.from : 0;

function copied(pending: Pending, from: number, to: number): Pending {
  const { front, offset, back, backEnd } = pending;
  const floor = Math.min(pending.floor, from);
  if (back?.kind === 'copy' && backEnd === from)
    return pendingOf(front, offset, back, to, floor);
  const link: Appended = {
    kind: 'copy',
    from,
    earlierEnd: backEnd,
    earlier: back,
  };
  return pendingOf(front, offset, link, to, floor);
}

function appended(pending: Pending, text: string): Pending {
  if (text.length === 0) return pending;
  const { front, offset, back, backEnd, floor } = pending;
  if (back?.kind === 'literal' && back.text === text)
    return pendingOf(front, offset, back, backEnd + text.length, floor);
  const link: Appended = {
    kind: 'literal',
    text,
    earlierEnd: backEnd,
    earlier: back,
  };
  return pendingOf(front, offset, link, text.length, floor);
}

function settled(pending: Pending): Pending {
  if (pending.front !== null || pending.back === null) return pending;
  let front: Piece | null = null;
  let end = pending.backEnd;
  for (
    let link: Appended | null = pending.back;
    link !== null;
    link = link.earlier
  ) {
    front =
      link.kind === 'copy'
        ? { kind: 'copy', from: link.from, end, next: front }
        : { kind: 'literal', text: link.text, end, next: front };
    end = link.earlierEnd;
  }
  return pendingOf(front, 0, null, 0, pending.floor);
}

function advanced(pending: Pending, length: number): Pending {
  const { front, back, backEnd } = pending;
  const piece = front!;
  const offset = pending.offset + length;
  const at = startOf(piece) + offset;
  const floor = piece.kind === 'copy' ? at : pending.floor;
  if (at < piece.end) return pendingOf(front, offset, back, backEnd, floor);
  const rest = piece.next;
  const empty = rest === null && back === null;
  return settled(pendingOf(rest, 0, back, backEnd, empty ? Infinity : floor));
}

function codePointIn(piece: Piece, at: number, input: TextBuffer): number {
  return piece.kind === 'copy'
    ? input.codePointAt(at)
    : piece.text.codePointAt(at % piece.text.length)!;
}

function textIn(
  piece: Piece,
  at: number,
  to: number,
  input: TextBuffer,
): string {
  if (piece.kind === 'copy') return input.slice(at, to);
  const { text } = piece;
  const base = at - (at % text.length);
  return text
    .repeat(Math.ceil((to - base) / text.length))
    .slice(at - base, to - base);
}

function shared(lead: Pending, other: Pending, input: TextBuffer): number {
  const first = lead.front;
  const second = other.front;
  if (first === null || second === null) return 0;
  const at = startOf(first) + lead.offset;
  const otherAt = startOf(second) + other.offset;
  const sameSource =
    first.kind === 'copy'
      ? second.kind === 'copy'
      : second.kind === 'literal' && first.text === second.text;
  if (sameSource && at === otherAt)
    return Math.min(first.end - at, second.end - otherAt);
  const value = codePointIn(first, at, input);
  return value === codePointIn(second, otherAt, input) ? width(value) : 0;
}

function encode(symbols: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < symbols.length; index += 4096)
    parts.push(String.fromCodePoint(...symbols.slice(index, index + 4096)));
  return parts.join('');
}

interface Transition {
  readonly target: number;
  readonly copy: boolean;
  readonly text: string;
}

interface Run {
  readonly node: number;
  readonly pending: Pending;
}

export class EarliestSession {
  private readonly atomStarts: readonly number[];
  private readonly ascii: Int32Array;
  private readonly final: readonly boolean[];
  private readonly transitions: readonly (readonly (readonly Transition[])[])[];
  private readonly input = new TextBuffer();
  private position = 0;
  private runs: readonly Run[];

  constructor(graph: Graph<number>) {
    const atomStarts = graph.atoms.map(([start]) => start);
    this.atomStarts = atomStarts;
    this.ascii = Int32Array.from({ length: 128 }, (_, symbol) =>
      lastAtOrBelow(atomStarts, symbol),
    );
    this.final = graph.nodes.map((node) => node.final);
    this.transitions = graph.nodes.map((node) =>
      node.edges.map((edges) =>
        edges.map(({ target, copy, output }) => ({
          target,
          copy,
          text: encode(output),
        })),
      ),
    );
    this.runs = graph.initial.map(({ node, output }) => ({
      node,
      pending: appended(emptyPending, encode(output)),
    }));
  }

  write(chunk: string): string {
    this.input.append(chunk);
    this.consume();
    return this.agreedOutput();
  }

  finish(): string {
    this.input.close();
    this.consume();
    this.runs = this.runs.filter((run) => this.final[run.node]);
    return this.agreedOutput();
  }

  private consume(): void {
    const { input } = this;
    while (this.position < input.end) {
      const symbol = input.codePointAt(this.position);
      const next = this.position + width(symbol);
      this.runs = this.step(symbol, this.position, next);
      this.position = next;
    }
  }

  private step(symbol: number, from: number, to: number): Run[] {
    const atom =
      symbol < 128
        ? this.ascii[symbol]
        : lastAtOrBelow(this.atomStarts, symbol);
    const next: Run[] = [];
    for (const { node, pending } of this.runs)
      for (const transition of this.transitions[node][atom]) {
        const source = transition.copy ? copied(pending, from, to) : pending;
        next.push({
          node: transition.target,
          pending: appended(source, transition.text),
        });
      }
    return next;
  }

  private agreedOutput(): string {
    if (this.runs.length === 0)
      throw new Error(
        'Bug in regex-stream-transform: no replacement path is left.',
      );
    const { input } = this;
    const parts: string[] = [];
    let runs = this.runs.map(({ node, pending }) => ({
      node,
      pending: settled(pending),
    }));
    while (true) {
      const lead = runs[0].pending;
      const length = Math.min(
        ...runs.map((run) => shared(lead, run.pending, input)),
      );
      if (length === 0) break;
      const piece = lead.front!;
      const at = startOf(piece) + lead.offset;
      parts.push(textIn(piece, at, at + length, input));
      runs = runs.map(({ node, pending }) => ({
        node,
        pending: advanced(pending, length),
      }));
    }
    this.runs = runs;
    input.release(
      Math.min(this.position, ...runs.map((run) => run.pending.floor)),
    );
    return parts.join('');
  }
}

export class Earliest {
  private readonly automaton: Automaton;
  private marks: Graph<Mark> | null | undefined;

  constructor(automaton: Automaton) {
    this.automaton = automaton;
  }

  replace({
    open,
    copy,
    close,
  }: {
    readonly open: string;
    readonly copy: boolean;
    readonly close: string;
  }): EarliestSession {
    const wrapping = {
      opening: codePoints(open),
      copy,
      closing: codePoints(close),
    };
    if (this.marks === undefined)
      this.marks = withinBudget(() =>
        markMatches(this.automaton, budget(BUDGET)),
      );
    const marks = this.marks;
    const graph =
      marks === null
        ? null
        : withinBudget(() => project(marks, wrapping, budget(BUDGET)));
    if (graph === null)
      throw new RangeError(
        'This pattern and replacement are too complex for the earliest option. Remove the option to replace normally.',
      );
    return new EarliestSession(graph);
  }
}
