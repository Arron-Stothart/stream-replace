import { Output } from './output.ts';
import type { Transducer } from './transducer.ts';

interface Run {
  readonly node: number;
  readonly output: Output;
}

export class ExactReplacer {
  private readonly machine: Transducer;
  private runs: Run[];
  private status: 'ready' | 'running' | 'closed' = 'ready';

  constructor(machine: Transducer) {
    this.machine = machine;
    this.runs = machine.initial.map(initial => {
      const output = new Output();
      output.append(initial.output);
      output.append(machine.nodes[initial.node].prefix);
      return { node: initial.node, output };
    });
  }

  write(symbols: Iterable<number>): number[] {
    if (this.status !== 'ready') throw new Error(`Replacer is ${this.status}`);
    this.status = 'running';
    const output: number[] = [];
    try {
      this.emit(output);
      for (const symbol of symbols) {
        if (!Number.isInteger(symbol) || symbol < 0 || symbol > 0x10ffff) throw new RangeError('Invalid code point');
        const next: Run[] = [];
        for (const run of this.runs) {
          const source = this.machine.nodes[run.node];
          for (const edge of source.edges) {
            if (symbol < edge.range[0] || symbol > edge.range[1]) continue;
            const label = edge.copy ? [symbol, ...edge.output.slice(1)] : edge.output;
            const pending = run.output.fork();
            pending.append([...label, ...this.machine.nodes[edge.target].prefix].slice(source.prefix.length));
            next.push({ node: edge.target, output: pending });
          }
        }
        this.runs = next;
        this.emit(output);
      }
      this.status = 'ready';
      return output;
    } catch (error) {
      this.status = 'closed';
      throw error;
    }
  }

  finish(): number[] {
    if (this.status !== 'ready') throw new Error(`Replacer is ${this.status}`);
    this.status = 'closed';
    this.runs = this.runs.filter(run => this.machine.nodes[run.node].final);
    const output: number[] = [];
    this.emit(output);
    return output;
  }

  private emit(output: number[]): void {
    if (this.runs.length === 0) throw new Error('No viable replacement path');
    while (true) {
      const symbol = this.runs[0].output.peek();
      if (symbol === undefined || this.runs.some(run => run.output.peek() !== symbol)) return;
      output.push(symbol);
      for (const run of this.runs) run.output.shift();
    }
  }
}
