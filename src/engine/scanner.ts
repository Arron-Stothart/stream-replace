import type { Automaton } from '../nfa/automaton.js';
import { TextBuffer, width } from './text.js';
import { END, UNKNOWN, Vm } from './vm.js';

export interface Found {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (string | undefined)[];
}

export interface Sink {
  text(text: string, start: number): void;
  progress(start: number, text: string): void;
  match(found: Found): void;
}

export class Scanner {
  private readonly buffer = new TextBuffer();
  private readonly vm: Vm;
  private readonly sink: Sink;
  private reported = 0;
  private covered = -1;
  private skip = false;
  private closed = false;

  constructor(automaton: Automaton, sink: Sink) {
    this.vm = new Vm(automaton);
    this.sink = sink;
  }

  write(chunk: string): void {
    this.buffer.append(chunk);
    this.run();
  }

  finish(): void {
    this.buffer.close();
    this.closed = true;
    this.run();
  }

  private run(): void {
    const { buffer, vm } = this;
    while (true) {
      if (this.skip) {
        if (this.reported === buffer.end) return;
        this.text(this.reported + width(buffer.codePointAt(this.reported)));
        this.skip = false;
        vm.restart(this.reported);
      }
      const at = vm.position;
      const next =
        at < buffer.end ? buffer.codePointAt(at) : this.closed ? END : UNKNOWN;
      const status = vm.advance(buffer.codePointBefore(at), next, width(next));
      if (status === 'matched') {
        this.match();
        continue;
      }
      const certain = status === 'searching' ? vm.certainEnd : -1;
      if (certain > this.covered) {
        const start = vm.frontier;
        this.text(start);
        this.sink.progress(
          start,
          buffer.slice(Math.max(this.covered, start), certain),
        );
        this.covered = certain;
      }
      if (status === 'blocked' || next < 0) {
        this.text(vm.frontier);
        return;
      }
    }
  }

  private match(): void {
    const { buffer, vm } = this;
    const { start, end, captures } = vm.accepted();
    this.text(start);
    this.sink.match({
      text: buffer.slice(start, end),
      start,
      end,
      captures: captures.map((span) =>
        span === null ? undefined : buffer.slice(span.start, span.end),
      ),
    });
    this.release(end);
    this.covered = -1;
    this.skip = start === end;
    if (!this.skip) vm.restart(end);
  }

  private text(to: number): void {
    if (to <= this.reported) return;
    this.sink.text(this.buffer.slice(this.reported, to), this.reported);
    this.release(to);
  }

  private release(to: number): void {
    this.reported = to;
    this.buffer.release(to);
  }
}
