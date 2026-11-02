import { compilePattern, type MatchOptions, type Pattern } from '../api.ts';
import type { Segment, ChunkProcessor } from '../core/chunk-processor.ts';
import type { Replacement } from '../core/replacement.ts';

export interface MatchStreamOptions extends MatchOptions {
  readonly pattern: string | RegExp | Pattern;
  readonly flags?: string;
}

export interface ReplaceStreamOptions extends MatchStreamOptions {
  readonly replacement: Replacement;
}

function resolve({ pattern, flags }: MatchStreamOptions): Pattern {
  if (typeof pattern === 'string' || pattern instanceof RegExp)
    return compilePattern(pattern, flags);
  if (flags !== undefined)
    throw new TypeError(
      'Flags cannot be passed with a compiled pattern. It already has its own flags.',
    );
  return pattern;
}

function transform<Output, Chunk>(
  processor: ChunkProcessor<Output>,
  chunks: (output: Output) => readonly Chunk[],
): TransformStream<string, Chunk> {
  const send = (
    output: Output,
    controller: TransformStreamDefaultController<Chunk>,
  ) => {
    for (const chunk of chunks(output)) controller.enqueue(chunk);
  };
  return new TransformStream({
    transform: (chunk, controller) => send(processor.write(chunk), controller),
    flush: (controller) => send(processor.finish(), controller),
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
  transform(resolve(options).matcher(options), (segments) => segments);
