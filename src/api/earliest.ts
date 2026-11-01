import type { Automaton } from '../nfa/automaton.js';
import { Budget, TooLarge, type Graph } from '../engine/earliest/graph.js';
import { project } from '../engine/earliest/project.js';
import { Runner } from '../engine/earliest/runner.js';
import { selection, type Mark } from '../engine/earliest/selection.js';
import { guard, type Session } from './session.js';
import type { Projection } from './template.js';

const BUDGET = 2_000_000;

const codePoints = (text: string): number[] =>
  Array.from(text, (character) => character.codePointAt(0)!);

function encode(symbols: readonly number[]): string {
  let result = '';
  for (let index = 0; index < symbols.length; index += 4096)
    result += String.fromCodePoint(...symbols.slice(index, index + 4096));
  return result;
}

export class Earliest {
  private readonly automaton: Automaton;
  private marks: Graph<Mark> | 'too-large' | null = null;
  private readonly projected = new Map<string, Graph<number> | 'too-large'>();

  constructor(automaton: Automaton) {
    this.automaton = automaton;
  }

  replacer(shape: Projection): Session<string> | null {
    const graph = this.graph(shape);
    return graph === null ? null : run(graph);
  }

  private graph({ open, inside, close }: Projection): Graph<number> | null {
    this.marks ??= attempt(() => selection(this.automaton, new Budget(BUDGET)));
    const marks = this.marks;
    if (marks === 'too-large') return null;
    const key = `${inside ? '+' : '-'}${open.length}:${open}${close}`;
    let graph = this.projected.get(key);
    if (graph === undefined) {
      const shape = {
        open: codePoints(open),
        inside,
        close: codePoints(close),
      };
      graph = attempt(() => project(marks, shape, new Budget(BUDGET)));
      this.projected.set(key, graph);
    }
    return graph === 'too-large' ? null : graph;
  }
}

function attempt<Value>(build: () => Value): Value | 'too-large' {
  try {
    return build();
  } catch (error) {
    if (error instanceof TooLarge) return 'too-large';
    throw error;
  }
}

function run(graph: Graph<number>): Session<string> {
  const runner = new Runner(graph);
  let held = '';
  const read = (text: string): string => {
    const output: number[] = [];
    runner.agree(output);
    for (const symbol of codePoints(text)) runner.read(symbol, output);
    return encode(output);
  };
  return guard({
    write(chunk) {
      const text = held + chunk;
      const last = text.charCodeAt(text.length - 1);
      const hold = last >= 0xd800 && last <= 0xdbff;
      held = hold ? text.slice(-1) : '';
      return read(hold ? text.slice(0, -1) : text);
    },
    finish() {
      const output = read(held);
      const rest: number[] = [];
      runner.finish(rest);
      return output + encode(rest);
    },
  });
}
