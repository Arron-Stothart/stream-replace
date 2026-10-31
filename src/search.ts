import { thread, type Acceptance, type Program } from './program.js';

interface Capture {
  readonly slot: number;
  readonly position: number;
  readonly previous: Capture | null;
}

interface Frame {
  readonly instruction: number;
  readonly position: number;
  readonly captures: Capture | null;
  readonly progressed: boolean;
  branch: number;
}

type Result =
  | { readonly kind: 'pending' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'matched'; readonly match: Acceptance };

export class Search<Symbol> {
  private readonly program: Program<Symbol>;
  private readonly failures = new Map<number, Set<number>>();
  private readonly frames: Frame[] = [];
  private position = 0;

  constructor(program: Program<Symbol>) {
    this.program = program;
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
      this.push(this.program.entry, this.position, null, false);

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      if (
        this.failures
          .get(frame.position)
          ?.has(thread(frame.instruction, frame.progressed))
      ) {
        this.frames.pop();
        continue;
      }

      const instruction = this.program.instructions[frame.instruction];
      switch (instruction.kind) {
        case 'accept': {
          const captures = Array<number | null>(
            this.program.captures.length * 2,
          ).fill(null);
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
        case 'reject':
          this.reject(frame);
          break;
        case 'assert': {
          if (frame.branch > 0) {
            this.reject(frame);
            break;
          }
          const accepted = instruction.accepts({
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
            this.push(
              instruction.next,
              frame.position,
              frame.captures,
              frame.progressed,
            );
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
            instruction.accepts(input.get(frame.position)!)
          ) {
            frame.branch++;
            this.push(
              instruction.next,
              frame.position + 1,
              frame.captures,
              true,
            );
          } else {
            this.reject(frame);
          }
          break;
        case 'save':
          if (frame.branch > 0) {
            this.reject(frame);
          } else {
            frame.branch++;
            this.push(
              instruction.next,
              frame.position,
              {
                slot: instruction.slot,
                position: frame.position,
                previous: frame.captures,
              },
              frame.progressed,
            );
          }
          break;
        case 'iterate':
          if (frame.branch > 0) {
            this.reject(frame);
          } else {
            frame.branch++;
            this.push(instruction.next, frame.position, frame.captures, false);
          }
          break;
        case 'progress':
          if (frame.branch > 0 || !frame.progressed) {
            this.reject(frame);
          } else {
            frame.branch++;
            this.push(instruction.next, frame.position, frame.captures, true);
          }
          break;
        case 'fork':
          if (frame.branch === 2) {
            this.reject(frame);
          } else {
            const next =
              frame.branch++ === 0
                ? instruction.preferred
                : instruction.fallback;
            this.push(next, frame.position, frame.captures, frame.progressed);
          }
          break;
      }
    }

    return { kind: 'rejected' };
  }

  private push(
    instruction: number,
    position: number,
    captures: Capture | null,
    progressed: boolean,
  ): void {
    this.frames.push({
      instruction,
      position,
      captures,
      progressed,
      branch: 0,
    });
  }

  private reject(frame: Frame): void {
    let states = this.failures.get(frame.position);
    if (states === undefined) {
      states = new Set();
      this.failures.set(frame.position, states);
    }
    states.add(thread(frame.instruction, frame.progressed));
    this.frames.pop();
  }
}
