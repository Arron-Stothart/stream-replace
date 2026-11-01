import { atomOf, written, type Graph } from './graph.js';
import { Queue } from './queue.js';

interface Run {
  readonly node: number;
  readonly pending: Queue<number>;
}

export class Simulation {
  private readonly graph: Graph<number>;
  private readonly ascii: Int32Array;
  private runs: Run[];

  constructor(graph: Graph<number>) {
    this.graph = graph;
    this.ascii = Int32Array.from({ length: 128 }, (_, symbol) =>
      atomOf(graph.atoms, symbol),
    );
    this.runs = graph.initial.map(({ node, output }) => {
      const pending = new Queue<number>();
      pending.append(output);
      return { node, pending };
    });
  }

  start(): number[] {
    const output: number[] = [];
    this.agree(output);
    return output;
  }

  read(symbol: number, output: number[]): void {
    const atom =
      symbol < 128 ? this.ascii[symbol] : atomOf(this.graph.atoms, symbol);
    const next: Run[] = [];
    for (const run of this.runs)
      for (const edge of this.graph.nodes[run.node].edges[atom]) {
        const pending = run.pending.fork();
        pending.append(written(edge, symbol));
        next.push({ node: edge.target, pending });
      }
    this.runs = next;
    this.agree(output);
  }

  finish(output: number[]): void {
    this.runs = this.runs.filter((run) => this.graph.nodes[run.node].final);
    this.agree(output);
  }

  private agree(output: number[]): void {
    const { runs } = this;
    if (runs.length === 0)
      throw new Error('Internal error: every replacement path died');
    while (true) {
      const value = runs[0].pending.peek();
      if (value === undefined) return;
      for (const run of runs) if (run.pending.peek() !== value) return;
      output.push(value);
      for (const run of runs) run.pending.shift();
    }
  }
}
