import {
  compilePattern,
  type Pattern,
  type ReplaceOptions,
  type TextEvent,
} from './pattern.js';
import type { TextReplacement } from './replacement.js';
import type { Session } from './session.js';

export interface MatchStreamOptions {
  readonly pattern: string | RegExp | Pattern;
  readonly flags?: string;
}

export interface ReplaceStreamOptions
  extends MatchStreamOptions, ReplaceOptions {
  readonly replacement: TextReplacement;
}

function resolve({ pattern, flags }: MatchStreamOptions): Pattern {
  if (typeof pattern === 'string' || pattern instanceof RegExp)
    return compilePattern(pattern, flags);
  if (flags !== undefined)
    throw new TypeError('Pass flags only with a string pattern');
  return pattern;
}

function transform<Output, Chunk>(
  session: Session<Output>,
  chunks: (output: Output) => readonly Chunk[],
): TransformStream<string, Chunk> {
  const send = (
    output: Output,
    controller: TransformStreamDefaultController<Chunk>,
  ) => {
    for (const chunk of chunks(output)) controller.enqueue(chunk);
  };
  return new TransformStream({
    transform: (chunk, controller) => send(session.write(chunk), controller),
    flush: (controller) => send(session.finish(), controller),
  });
}

export const replaceInStream = (
  options: ReplaceStreamOptions,
): TransformStream<string, string> =>
  transform(resolve(options).replacer(options.replacement, options), (text) =>
    text ? [text] : [],
  );

export const matchInStream = (
  options: MatchStreamOptions,
): TransformStream<string, TextEvent> =>
  transform(resolve(options).matcher(), (events) => events);
