import type { Automaton } from '../nfa/automaton.js';
import { TextBuffer } from './text.js';
import { Vm, type Acceptance, type Lookahead } from './vm.js';

export interface Sink {
  text(from: number, to: number): void;
  progress(start: number, to: number): void;
  match(match: Acceptance): void;
}

export class Scanner {
  private readonly buffer: TextBuffer;
  private readonly vm: Vm;
  private readonly sink: Sink;
  private reported = 0;
  private covered = -1;
  private skip = false;
  private closed = false;

  constructor(automaton: Automaton, buffer: TextBuffer, sink: Sink) {
    this.vm = new Vm(automaton);
    this.buffer = buffer;
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
        const [, length] = buffer.codePointAt(this.reported);
        this.text(this.reported + length);
        this.skip = false;
        vm.restart(this.reported);
      }
      const at = vm.position;
      const available = at < buffer.end;
      const [symbol, width] = available ? buffer.codePointAt(at) : [0, 0];
      const next: Lookahead = available
        ? { kind: 'symbol', symbol }
        : this.closed
          ? { kind: 'end' }
          : { kind: 'unknown' };
      if (!vm.expand(buffer.codePointBefore(at), next)) return;
      if (next.kind === 'end') vm.halt();

      if (vm.settled) {
        const match = vm.accepted();
        this.text(match.start);
        this.sink.match(match);
        this.release(match.end);
        this.covered = -1;
        this.skip = match.start === match.end;
        if (!this.skip) vm.restart(match.end);
        continue;
      }
      this.text(vm.frontier);
      const certain = vm.certain;
      if (certain !== null && certain.end > this.covered) {
        this.sink.progress(certain.start, certain.end);
        this.covered = certain.end;
      }
      if (next.kind !== 'symbol') return;
      vm.step(symbol, width);
    }
  }

  private text(to: number): void {
    if (to <= this.reported) return;
    this.sink.text(this.reported, to);
    this.release(to);
  }

  private release(to: number): void {
    this.reported = to;
    this.buffer.release(to);
  }
}
