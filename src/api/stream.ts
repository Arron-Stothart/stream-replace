import type { Segment } from './match.js';
import {
  compilePattern,
  type Pattern,
  type ReplaceOptions,
} from './pattern.js';
import type { Replacement } from './replacement.js';
import type { Session } from './session.js';

export interface MatchStreamOptions {
  readonly pattern: string | RegExp | Pattern;
  readonly flags?: string;
}

export interface ReplaceStreamOptions
  extends MatchStreamOptions, ReplaceOptions {
  readonly replacement: Replacement;
}

function resolve({ pattern, flags }: MatchStreamOptions): Pattern {
  if (typeof pattern === 'string' || pattern instanceof RegExp)
    return compilePattern(pattern, flags);
  if (flags !== undefined)
    throw new TypeError('A compiled pattern already has its flags');
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
): TransformStream<string, Segment> =>
  transform(resolve(options).matcher(), (segments) => segments);
