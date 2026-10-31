import type { Acceptance } from './program.ts';
import type { Program } from './program.ts';
import { Search } from './search.ts';

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Match<Symbol> extends Span {
  readonly symbols: readonly Symbol[];
  readonly captures: ReadonlyMap<string, Span | null>;
}

export type Replacement<Symbol> = Iterable<Symbol> | ((match: Match<Symbol>) => Iterable<Symbol>);

export class Replacer<Symbol> {
  private readonly program: Program<Symbol>;
  private readonly search: Search<Symbol>;
  private readonly replacement: Replacement<Symbol>;
  private readonly input = new Map<number, Symbol>();
  private position = 0;
  private end = 0;
  private previous: Symbol | undefined;
  private skipEmpty = false;
  private status: 'ready' | 'running' | 'finished' | 'failed' = 'ready';

  constructor(program: Program<Symbol>, replacement: Replacement<Symbol>) {
    this.program = program;
    this.search = new Search(program);
    this.replacement = typeof replacement === 'function' ? replacement : [...replacement];
  }

  write(symbols: Iterable<Symbol>): Symbol[] {
    return this.run(symbols, false);
  }

  finish(): Symbol[] {
    return this.run([], true);
  }

  private run(symbols: Iterable<Symbol>, closed: boolean): Symbol[] {
    if (this.status !== 'ready') throw new Error(`Cannot write to a ${this.status} replacer`);
    this.status = 'running';
    const output: Symbol[] = [];

    try {
      this.drain(output, false);
      for (const symbol of symbols) {
        this.input.set(this.end++, symbol);
        this.drain(output, false);
      }
      if (closed) this.drain(output, true);
      this.status = closed ? 'finished' : 'ready';
      return output;
    } catch (error) {
      this.status = 'failed';
      throw error;
    }
  }

  private drain(output: Symbol[], closed: boolean): void {
    while (true) {
      if (this.skipEmpty) {
        if (this.position === this.end) return;
        output.push(this.input.get(this.position)!);
        this.release(this.position + 1);
        this.skipEmpty = false;
      }

      const result = this.search.resume(this.input, this.end, closed, this.previous);
      if (result.kind === 'pending') return;
      if (result.kind === 'rejected') {
        if (this.position === this.end) return;
        output.push(this.input.get(this.position)!);
        this.release(this.position + 1);
        continue;
      }

      const { start, end } = result.match;
      const replacement = typeof this.replacement === 'function'
        ? this.replacement(this.match(result.match))
        : this.replacement;
      for (const symbol of replacement) output.push(symbol);
      this.skipEmpty = start === end;
      this.release(end);
    }
  }

  private match(acceptance: Acceptance): Match<Symbol> {
    const { start, end, captures: slots } = acceptance;
    const symbols: Symbol[] = [];
    for (let index = start; index < end; index++) symbols.push(this.input.get(index)!);
    const captures = new Map<string, Span | null>();
    for (let index = 0; index < this.program.captures.length; index++) {
      const start = slots[index * 2];
      const end = slots[index * 2 + 1];
      captures.set(this.program.captures[index], start === null || end === null ? null : { start, end });
    }
    return { start, end, symbols, captures };
  }

  private release(position: number): void {
    while (this.position < position) {
      this.previous = this.input.get(this.position);
      this.input.delete(this.position++);
    }
    this.search.restart(position);
  }
}
