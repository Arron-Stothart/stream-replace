import type { CompiledPattern } from './compiled-pattern.ts';
import { Scanner, type Decisions, type Span } from './matching.ts';
import { TextBuffer } from './text.ts';

export interface ChunkProcessor<Output> {
  write(chunk: string): Output;
  finish(): Output;
}

export interface Match {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (string | undefined)[];
  readonly groups: Readonly<Record<string, string | undefined>> | undefined;
}

export type Segment =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly start: number;
      readonly end: number;
    }
  | ({ readonly kind: 'match' } & Match);

export interface Collector<Output> {
  text(text: string, start: number): void;
  inside?(text: string): void;
  match(match: Match): void;
  take(): Output;
}

function matchAt(
  buffer: TextBuffer,
  start: number,
  end: number,
  spans: readonly (Span | null)[],
  names: readonly (string | null)[],
): Match {
  const captures = spans.map((span) =>
    span === null ? undefined : buffer.slice(span.start, span.end),
  );
  const named = names.flatMap((name, index) =>
    name === null ? [] : [[name, captures[index]] as const],
  );
  return {
    text: buffer.slice(start, end),
    start,
    end,
    captures,
    groups: named.length === 0 ? undefined : Object.fromEntries(named),
  };
}

export function createChunkProcessor<Output>(
  compiledPattern: CompiledPattern,
  limit: number,
  collector: Collector<Output>,
): ChunkProcessor<Output> {
  const buffer = new TextBuffer();
  const scanner = new Scanner(compiledPattern, limit);
  const decisions: Decisions = {
    outside(from, to) {
      collector.text(buffer.slice(from, to), from);
      buffer.release(to);
    },
    inside(from, to) {
      collector.inside?.(buffer.slice(from, to));
    },
    match(start, end, spans) {
      collector.match(
        matchAt(buffer, start, end, spans, compiledPattern.captures),
      );
      buffer.release(end);
    },
  };
  const run = (): Output => {
    scanner.run(buffer, decisions);
    return collector.take();
  };
  return {
    write(chunk) {
      buffer.append(chunk);
      return run();
    },
    finish() {
      buffer.close();
      return run();
    },
  };
}

export function segments(): Collector<Segment[]> {
  const output: Segment[] = [];
  return {
    text(text, start) {
      const last = output.at(-1);
      const end = start + text.length;
      if (last?.kind === 'text' && last.end === start)
        output[output.length - 1] = { ...last, text: last.text + text, end };
      else output.push({ kind: 'text', text, start, end });
    },
    match(match) {
      output.push({ kind: 'match', ...match });
    },
    take: () => output.splice(0),
  };
}
