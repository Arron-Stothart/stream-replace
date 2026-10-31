import type { Machine } from './machine.js';
import type { Acceptance } from './program.js';

interface Capture {
  readonly slot: number;
  readonly position: number;
  readonly previous: Capture | null;
}

interface Frame {
  readonly thread: number;
  readonly position: number;
  readonly captures: Capture | null;
  branch: number;
}

type Result =
  | { readonly kind: 'pending' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'matched'; readonly match: Acceptance };

export class Search<Symbol> {
  private readonly machine: Machine<Symbol>;
  private readonly failures = new Map<number, Set<number>>();
  private readonly frames: Frame[] = [];
  private position = 0;

  constructor(machine: Machine<Symbol>) {
    this.machine = machine;
  }

  restart(position: number): void {
    for (let index = this.position; index < position; index++)
      this.failures.delete(index);
    this.position = position;
    this.frames.length = 0;
  }

  resume(
    input: ReadonlyMap<number, Symbol>,
    end: number,
    closed: boolean,
    previous?: Symbol,
  ): Result {
    if (this.frames.length === 0)
      this.push(this.machine.entry, this.position, null);

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      if (this.failures.get(frame.position)?.has(frame.thread)) {
        this.frames.pop();
        continue;
      }

      const step = this.machine.steps[frame.thread];
      switch (step.kind) {
        case 'accept': {
          const captures = Array<number | null>(this.machine.captures * 2).fill(
            null,
          );
          for (
            let saved = frame.captures;
            saved !== null;
            saved = saved.previous
          ) {
            captures[saved.slot] ??= saved.position;
          }
          return {
            kind: 'matched',
            match: { start: this.position, end: frame.position, captures },
          };
        }
        case 'assert': {
          if (frame.branch > 0) {
            this.reject(frame);
            break;
          }
          const accepted = step.accepts({
            position: frame.position,
            previous:
              frame.position === this.position
                ? previous
                : input.get(frame.position - 1),
            next: input.get(frame.position),
            hasNext: frame.position < end,
            ended: closed && frame.position === end,
          });
          if (accepted === undefined) return { kind: 'pending' };
          if (!accepted) this.reject(frame);
          else {
            frame.branch++;
            this.push(step.next, frame.position, frame.captures);
          }
          break;
        }
        case 'consume':
          if (frame.branch > 0) {
            this.reject(frame);
          } else if (frame.position === end && !closed) {
            return { kind: 'pending' };
          } else if (
            frame.position < end &&
            step.accepts(input.get(frame.position)!)
          ) {
            frame.branch++;
            this.push(step.next, frame.position + 1, frame.captures);
          } else {
            this.reject(frame);
          }
          break;
        case 'save':
          if (frame.branch > 0) {
            this.reject(frame);
          } else {
            frame.branch++;
            this.push(step.next, frame.position, {
              slot: step.slot,
              position: frame.position,
              previous: frame.captures,
            });
          }
          break;
        case 'choose':
          if (frame.branch === step.successors.length) {
            this.reject(frame);
          } else {
            this.push(
              step.successors[frame.branch++],
              frame.position,
              frame.captures,
            );
          }
          break;
      }
    }

    return { kind: 'rejected' };
  }

  private push(
    thread: number,
    position: number,
    captures: Capture | null,
  ): void {
    this.frames.push({ thread, position, captures, branch: 0 });
  }

  private reject(frame: Frame): void {
    let threads = this.failures.get(frame.position);
    if (threads === undefined) {
      threads = new Set();
      this.failures.set(frame.position, threads);
    }
    threads.add(frame.thread);
    this.frames.pop();
  }
}
