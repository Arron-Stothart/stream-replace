import { scalar } from './alphabet.js';
import { slots, type Saved } from './capture.js';
import { label, type Graph } from './graph.js';
import type { Acceptance } from './program.js';
import { Queue } from './queue.js';
import { match, type Match } from './replace.js';
import type { Mark } from './selection.js';
import { session, type Session } from './session.js';

function agree<Value>(
  queues: readonly Queue<Value>[],
  same: (left: Value, right: Value) => boolean,
  take: (value: Value) => void,
): void {
  if (queues.length === 0) throw new Error('No viable replacement path');
  while (true) {
    const value = queues[0].peek();
    if (value === undefined) return;
    for (const queue of queues) {
      const other = queue.peek();
      if (other === undefined || !same(value, other)) return;
    }
    take(value);
    for (const queue of queues) queue.shift();
  }
}

function validate(symbol: number): number {
  if (!scalar(symbol)) throw new RangeError('Invalid code point');
  return symbol;
}

interface LiteralRun {
  readonly node: number;
  readonly output: Queue<number>;
}

export function exactReplacer(
  machine: Graph<number>,
): Session<Iterable<number>, number[]> {
  let runs: LiteralRun[] = machine.initial.map((initial) => {
    const output = new Queue<number>();
    output.append(initial.output);
    return { node: initial.node, output };
  });

  function emit(output: number[]): void {
    agree(
      runs.map((run) => run.output),
      (left, right) => left === right,
      (symbol) => output.push(symbol),
    );
  }

  return session(
    (symbols) => {
      const output: number[] = [];
      emit(output);
      for (const value of symbols) {
        const symbol = validate(value);
        const next: LiteralRun[] = [];
        for (const run of runs) {
          for (const edge of machine.nodes[run.node].edges) {
            if (symbol < edge.range[0] || symbol > edge.range[1]) continue;
            const pending = run.output.fork();
            pending.append(label(edge, symbol));
            next.push({ node: edge.target, output: pending });
          }
        }
        runs = next;
        emit(output);
      }
      return output;
    },
    () => {
      runs = runs.filter((run) => machine.nodes[run.node].final);
      const output: number[] = [];
      emit(output);
      return output;
    },
  );
}

type Item =
  | { readonly kind: 'text'; readonly position: number }
  | { readonly kind: 'match'; readonly acceptance: Acceptance };

interface MatchRun {
  readonly node: number;
  readonly items: Queue<Item>;
  readonly start: number | null;
  readonly saved: Saved | null;
}

function same(left: Item, right: Item): boolean {
  if (left.kind === 'text')
    return right.kind === 'text' && left.position === right.position;
  if (right.kind === 'text') return false;
  const { acceptance: a } = left;
  const { acceptance: b } = right;
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.captures.every((value, index) => value === b.captures[index])
  );
}

export function settledReplacer(
  selected: Graph<Mark>,
  names: readonly string[],
  replacement: (match: Match<number>) => Iterable<number>,
): Session<Iterable<number>, number[]> {
  const input = new Map<number, number>();
  let received = 0;
  let released = 0;

  function follow(
    from: MatchRun | null,
    node: number,
    copied: boolean,
    marks: readonly Mark[],
  ): MatchRun {
    const items = from === null ? new Queue<Item>() : from.items.fork();
    let start = from?.start ?? null;
    let saved = from?.saved ?? null;
    if (copied) items.append([{ kind: 'text', position: received - 1 }]);
    for (const mark of marks) {
      switch (mark.kind) {
        case 'open':
          start = received;
          saved = null;
          break;
        case 'save':
          saved = { slot: mark.slot, position: received, previous: saved };
          break;
        case 'close':
          items.append([
            {
              kind: 'match',
              acceptance: {
                start: start!,
                end: received,
                captures: slots(saved, names.length),
              },
            },
          ]);
          start = null;
          saved = null;
          break;
      }
    }
    return { node, items, start, saved };
  }

  let runs: MatchRun[] = selected.initial.map((initial) =>
    follow(null, initial.node, false, initial.output),
  );

  function release(next: number): void {
    while (released < next) input.delete(released++);
  }

  function emit(output: number[]): void {
    agree(
      runs.map((run) => run.items),
      same,
      (item) => {
        if (item.kind === 'text') {
          output.push(input.get(item.position)!);
          release(item.position + 1);
        } else {
          for (const symbol of replacement(
            match(item.acceptance, input, names),
          ))
            output.push(symbol);
          release(item.acceptance.end);
        }
      },
    );
  }

  return session(
    (symbols) => {
      const output: number[] = [];
      emit(output);
      for (const value of symbols) {
        const symbol = validate(value);
        input.set(received++, symbol);
        const next: MatchRun[] = [];
        for (const run of runs) {
          for (const edge of selected.nodes[run.node].edges) {
            if (symbol < edge.range[0] || symbol > edge.range[1]) continue;
            next.push(follow(run, edge.target, edge.copy, edge.output));
          }
        }
        runs = next;
        emit(output);
      }
      return output;
    },
    () => {
      runs = runs.filter((run) => selected.nodes[run.node].final);
      const output: number[] = [];
      emit(output);
      return output;
    },
  );
}
