import { label, type Graph } from './graph.js';
import { scalar } from './alphabet.js';
import { Output } from './output.js';
import { session, type Session } from './session.js';

interface Run {
  readonly node: number;
  readonly output: Output;
}

export function exactReplacer(
  machine: Graph,
): Session<Iterable<number>, number[]> {
  let runs: Run[] = machine.initial.map((initial) => {
    const output = new Output();
    output.append(initial.output);
    return { node: initial.node, output };
  });

  function emit(output: number[]): void {
    if (runs.length === 0) throw new Error('No viable replacement path');
    while (true) {
      const symbol = runs[0].output.peek();
      if (
        symbol === undefined ||
        runs.some((run) => run.output.peek() !== symbol)
      )
        return;
      output.push(symbol);
      for (const run of runs) run.output.shift();
    }
  }

  return session(
    (symbols) => {
      const output: number[] = [];
      emit(output);
      for (const symbol of symbols) {
        if (!scalar(symbol)) throw new RangeError('Invalid code point');
        const next: Run[] = [];
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
