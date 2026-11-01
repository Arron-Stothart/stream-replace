import { compile } from './compile.js';
import { Decoder, decode, encode } from './decode.js';
import type { Event, Match, Matcher } from './events.js';
import { exactReplacer, settledMatcher } from './exact.js';
import type { Graph } from './graph.js';
import { parse } from './parse.js';
import type { Program } from './program.js';
import { selection, type Mark } from './selection.js';
import { session, type Session } from './session.js';
import type { TextMatch, TextReplacement } from './substitution.js';
import { compileTemplate } from './template.js';
import { literalProjection, project, type Projection } from './transducer.js';

export type TextEvent =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly start: number;
      readonly end: number;
    }
  | { readonly kind: 'match'; readonly match: TextMatch };

export type TextMatcher = Session<string, TextEvent[]>;

export interface TextReplacer extends Session<string, string> {
  readonly emission: 'earliest' | 'after-match';
}

export interface Pattern {
  readonly program: Program<number>;
  matcher(): TextMatcher;
  replacer(replacement: TextReplacement): TextReplacer;
}

export interface MatchOptions {
  readonly pattern: string | RegExp | Pattern;
  readonly flags?: string;
}

export interface TextOptions extends MatchOptions {
  readonly replacement: TextReplacement;
}

function textMatch(match: Match<number>, start: number): TextMatch {
  const captures = new Map<string, string | undefined>();
  for (const [name, span] of match.captures) {
    captures.set(
      name,
      span === null
        ? undefined
        : encode(
            match.symbols.slice(
              span.start - match.start,
              span.end - match.start,
            ),
          ),
    );
  }
  const text = encode(match.symbols);
  return {
    text,
    groups: [...captures.values()],
    captures,
    start,
    end: start + text.length,
  };
}

function textMatcher(matches: Matcher<number>): TextMatcher {
  const decoder = new Decoder();
  let offset = 0;

  function convert(events: readonly Event<number>[]): TextEvent[] {
    return events.map((event): TextEvent => {
      const start = offset;
      if (event.kind === 'text') {
        const text = encode(event.symbols);
        offset += text.length;
        return { kind: 'text', text, start, end: offset };
      }
      const match = textMatch(event.match, start);
      offset = match.end;
      return { kind: 'match', match };
    });
  }

  return session(
    (chunk: string) => convert(matches.write(decoder.write(chunk))),
    () => [
      ...convert(matches.write(decoder.finish())),
      ...convert(matches.finish()),
    ],
  );
}

function mapped(
  matches: TextMatcher,
  apply: (match: TextMatch) => string,
): TextReplacer {
  const render = (events: readonly TextEvent[]): string =>
    events
      .map((event) => {
        if (event.kind === 'text') return event.text;
        const output = apply(event.match);
        decode(output);
        return output;
      })
      .join('');
  return {
    emission: 'after-match',
    ...session(
      (chunk: string) => render(matches.write(chunk)),
      () => render(matches.finish()),
    ),
  };
}

function projected(machine: Graph<number>): TextReplacer {
  const decoder = new Decoder();
  const processor = exactReplacer(machine);
  return {
    emission: 'earliest',
    ...session(
      (chunk: string) => encode(processor.write(decoder.write(chunk))),
      () =>
        encode(processor.write(decoder.finish())) + encode(processor.finish()),
    ),
  };
}

export function compilePattern(source: string, flags = ''): Pattern {
  const program = compile(parse(source, flags));
  let selected: Graph<Mark> | undefined;
  const selectionGraph = (): Graph<Mark> => (selected ??= selection(program));
  const projections = new Map<string, Graph<number>>();

  function projection(projection: Projection): TextReplacer {
    const key = JSON.stringify(projection);
    let machine = projections.get(key);
    if (machine === undefined) {
      machine = project(selectionGraph(), projection);
      projections.set(key, machine);
    }
    return projected(machine);
  }

  const matcher = (): TextMatcher =>
    textMatcher(settledMatcher(selectionGraph(), program.captures));

  return {
    program,
    matcher,
    replacer(replacement) {
      switch (replacement.kind) {
        case 'callback':
          return mapped(matcher(), replacement.apply);
        case 'literal':
          return projection(literalProjection(decode(replacement.value)));
        case 'template': {
          const compiled = compileTemplate(
            replacement.source,
            program.captures,
          );
          return compiled.kind === 'projection'
            ? projection(compiled.projection)
            : mapped(matcher(), compiled.apply);
        }
      }
    },
  };
}

export function resolvePattern(
  input: MatchOptions['pattern'],
  flags = '',
): Pattern {
  if (typeof input === 'string') return compilePattern(input, flags);
  if (flags)
    throw new TypeError('Supply flags only when the pattern is a string');
  return input instanceof RegExp
    ? compilePattern(input.source, input.flags)
    : input;
}

function streamOf<Output, Chunk>(
  processor: Session<string, Output>,
  chunks: (output: Output) => readonly Chunk[],
): Transformer<string, Chunk> {
  const enqueue = (
    output: Output,
    controller: TransformStreamDefaultController<Chunk>,
  ): void => {
    for (const chunk of chunks(output)) controller.enqueue(chunk);
  };
  return {
    transform: (chunk, controller) =>
      enqueue(processor.write(chunk), controller),
    flush: (controller) => enqueue(processor.finish(), controller),
  };
}

export const replaceInStream = ({
  pattern,
  replacement,
  flags = '',
}: TextOptions): TransformStream<string, string> =>
  new TransformStream(
    streamOf(resolvePattern(pattern, flags).replacer(replacement), (output) =>
      output ? [output] : [],
    ),
  );

export const matchInStream = ({
  pattern,
  flags = '',
}: MatchOptions): TransformStream<string, TextEvent> =>
  new TransformStream(
    streamOf(resolvePattern(pattern, flags).matcher(), (events) => events),
  );
