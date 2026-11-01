import type { Automaton } from './automaton.ts';
import { Search, type Decisions, type Span } from './search.ts';
import { TextBuffer } from './text.ts';

export interface Session<Output> {
  write(chunk: string): Output;
  finish(): Output;
}

export interface Projection {
  readonly open: string;
  readonly copy: boolean;
  readonly close: string;
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

type Part =
  | string
  | { readonly kind: 'match' }
  | { readonly kind: 'group'; readonly index: number };

const references = /(\$(?:[$&`']|\d\d?))/;
const namedReferences = /(\$(?:[$&`']|\d\d?|<[^>]*>))/;

export class Template {
  private readonly parts: readonly Part[];

  constructor(source: string, names: readonly (string | null)[]) {
    const named = names.some((name) => name !== null);
    const resolve = (token: string): readonly Part[] => {
      const body = token.slice(1);
      if (body === '$') return ['$'];
      if (body === '&') return [{ kind: 'match' }];
      if (body === '`' || body === "'")
        throw new SyntaxError(
          `$${body} is not supported, because it needs text from outside the match.`,
        );
      if (body.startsWith('<')) {
        const index = names.indexOf(body.slice(1, -1));
        return index < 0 ? [] : [{ kind: 'group', index }];
      }
      const digits =
        body.length === 2 && Number(body) > names.length ? body[0] : body;
      const rest = body.slice(digits.length);
      const index = Number(digits);
      return index >= 1 && index <= names.length
        ? [{ kind: 'group', index: index - 1 }, rest]
        : [`$${digits}`, rest];
    };
    this.parts = source
      .split(named ? namedReferences : references)
      .flatMap((piece, index) => (index % 2 === 0 ? [piece] : resolve(piece)));
  }

  projection(): Projection | null {
    const references = this.parts.filter((part) => typeof part !== 'string');
    if (
      references.length > 1 ||
      references.some((part) => part.kind === 'group')
    )
      return null;
    const split =
      references.length === 0
        ? this.parts.length
        : this.parts.indexOf(references[0]);
    return {
      open: this.parts.slice(0, split).join(''),
      copy: references.length === 1,
      close: this.parts.slice(split + 1).join(''),
    };
  }

  render(match: Match): string {
    return this.parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : part.kind === 'match'
            ? match.text
            : (match.captures[part.index] ?? ''),
      )
      .join('');
  }
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

export function drive<Output>(
  automaton: Automaton,
  limit: number,
  collector: Collector<Output>,
): Session<Output> {
  const buffer = new TextBuffer();
  const search = new Search(automaton, limit);
  const decisions: Decisions = {
    outside(from, to) {
      collector.text(buffer.slice(from, to), from);
      buffer.release(to);
    },
    inside(from, to) {
      collector.inside?.(buffer.slice(from, to));
    },
    match(start, end, spans) {
      collector.match(matchAt(buffer, start, end, spans, automaton.captures));
      buffer.release(end);
    },
  };
  const run = (): Output => {
    search.run(buffer, decisions);
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

class TextOutput {
  private readonly parts: string[] = [];

  readonly append = (text: string): void => {
    this.parts.push(text);
  };

  take(): string {
    return this.parts.splice(0).join('');
  }
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

export function mapping(apply: (match: Match) => string): Collector<string> {
  const output = new TextOutput();
  return {
    text: output.append,
    match(match) {
      const replacement = apply(match);
      if (typeof replacement !== 'string')
        throw new TypeError(
          `The mapMatch function must return a string, not ${typeof replacement}.`,
        );
      output.append(replacement);
    },
    take: () => output.take(),
  };
}

export function projecting({
  open,
  copy,
  close,
}: Projection): Collector<string> {
  const output = new TextOutput();
  let opened = false;
  let copied = 0;
  const begin = (): void => {
    if (!opened) output.append(open);
    opened = true;
  };
  return {
    text: output.append,
    inside(text) {
      begin();
      if (copy) output.append(text);
      copied += text.length;
    },
    match({ text }) {
      begin();
      if (copy) output.append(text.slice(copied));
      output.append(close);
      opened = false;
      copied = 0;
    },
    take: () => output.take(),
  };
}
