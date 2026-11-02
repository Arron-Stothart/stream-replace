import { compile } from './core/compiled-pattern.ts';
import {
  createChunkProcessor,
  segments,
  type Match,
  type Segment,
  type ChunkProcessor,
} from './core/chunk-processor.ts';
import { replacing, type Replacement } from './core/replacement.ts';
import { parse, type Flags } from './core/syntax.ts';

export const literal = (value: string): Replacement => ({
  kind: 'literal',
  value,
});

export const template = (source: string): Replacement => ({
  kind: 'template',
  source,
});

export const mapMatch = (apply: (match: Match) => string): Replacement => ({
  kind: 'map',
  apply,
});

export interface MatchOptions {
  readonly maxMatchLength?: number;
}

export interface Replacer {
  write(chunk: string): string;
  finish(): string;
}

export interface Matcher {
  write(chunk: string): Segment[];
  finish(): Segment[];
}

export interface Pattern {
  readonly source: string;
  readonly flags: string;
  matcher(options?: MatchOptions): Matcher;
  replacer(replacement: Replacement, options?: MatchOptions): Replacer;
}

function readSource(
  pattern: string | RegExp,
  flags: string | undefined,
): { source: string; flags: string; settings: Flags } {
  if (pattern instanceof RegExp) {
    if (flags !== undefined)
      throw new TypeError(
        'Flags can only be passed with a string pattern. A RegExp already has its own flags.',
      );
    if (!pattern.unicode && !pattern.flags.includes('v'))
      throw new SyntaxError(
        'A RegExp pattern needs the u flag, for example /abc/u.',
      );
  }
  const source = pattern instanceof RegExp ? pattern.source : pattern;
  const given = (pattern instanceof RegExp ? pattern.flags : flags) ?? '';
  if (given.includes('v'))
    throw new SyntaxError(
      'The v flag is not supported. Use the u flag instead.',
    );
  if (/[^dgimsu]/.test(given) || new Set(given).size !== given.length)
    throw new SyntaxError(
      `"${given}" has an unknown or repeated flag. Use only d, g, i, m, s and u, each once.`,
    );
  const canonical = [...'ims'].filter((flag) => given.includes(flag)).join('');
  return {
    source,
    flags: `${canonical}u`,
    settings: {
      ignoreCase: given.includes('i'),
      multiline: given.includes('m'),
      dotAll: given.includes('s'),
    },
  };
}

function checked<Output>(
  inner: ChunkProcessor<Output>,
): ChunkProcessor<Output> {
  let status: 'ready' | 'running' | 'finished' | 'failed' = 'ready';
  function run(final: boolean, operation: () => Output): Output {
    if (status !== 'ready')
      throw new TypeError(
        {
          running:
            'This stream is still running an earlier call. Wait for it to return first.',
          finished: 'This stream has already finished.',
          failed: 'This stream failed earlier and cannot be used again.',
        }[status],
      );
    status = 'running';
    try {
      const output = operation();
      status = final ? 'finished' : 'ready';
      return output;
    } catch (error) {
      status = 'failed';
      throw error;
    }
  }
  return {
    write: (chunk) => {
      if (typeof chunk !== 'string')
        throw new TypeError(`write() expects a string, not ${typeof chunk}.`);
      return run(false, () => inner.write(chunk));
    },
    finish: () => run(true, () => inner.finish()),
  };
}

function limitOf({ maxMatchLength = Infinity }: MatchOptions): number {
  if (
    maxMatchLength !== Infinity &&
    !(Number.isSafeInteger(maxMatchLength) && maxMatchLength >= 0)
  )
    throw new RangeError('maxMatchLength must be a whole number, 0 or more.');
  return maxMatchLength;
}

function replacementOf(replacement: Replacement): Replacement {
  switch (replacement?.kind) {
    case 'literal':
      if (typeof replacement.value !== 'string') break;
      return replacement;
    case 'template':
      if (typeof replacement.source !== 'string') break;
      return replacement;
    case 'map': {
      const { apply } = replacement;
      if (typeof apply !== 'function') break;
      return mapMatch((match) => {
        const text = apply(match);
        if (typeof text !== 'string')
          throw new TypeError(
            `The mapMatch function must return a string, not ${typeof text}.`,
          );
        return text;
      });
    }
  }
  throw new TypeError(
    'The replacement must come from literal(), template() or mapMatch().',
  );
}

export function compilePattern(
  pattern: string | RegExp,
  flags?: string,
): Pattern {
  const { source, flags: canonical, settings } = readSource(pattern, flags);
  const compiledPattern = compile(parse(source, settings));

  function replacer(
    replacement: Replacement,
    options: MatchOptions = {},
  ): Replacer {
    const collector = replacing(
      replacementOf(replacement),
      compiledPattern.captures,
    );
    return checked(
      createChunkProcessor(compiledPattern, limitOf(options), collector),
    );
  }

  function matcher(options: MatchOptions = {}): Matcher {
    return checked(
      createChunkProcessor(compiledPattern, limitOf(options), segments()),
    );
  }

  return { source, flags: canonical, matcher, replacer };
}
