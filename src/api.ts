import { compile } from './automaton.ts';
import {
  mapping,
  projecting,
  drive,
  segments,
  Template,
  type Match,
  type Projection,
  type Segment,
  type Session,
} from './output.ts';
import { parse, type Flags } from './syntax.ts';

export type Replacement =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'map'; readonly apply: (match: Match) => string };

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

export interface Pattern {
  readonly source: string;
  readonly flags: string;
  matcher(options?: MatchOptions): Session<Segment[]>;
  replacer(replacement: Replacement, options?: MatchOptions): Session<string>;
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

const unavailable = {
  running:
    'This stream is still running an earlier call. Wait for it to return first.',
  finished: 'This stream has already finished.',
  failed: 'This stream failed earlier and cannot be used again.',
};

function guard<Output>(inner: Session<Output>): Session<Output> {
  let status: 'ready' | 'running' | 'finished' | 'failed' = 'ready';
  function run(final: boolean, operation: () => Output): Output {
    if (status !== 'ready') throw new TypeError(unavailable[status]);
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

const invalidReplacement =
  'The replacement must come from literal(), template() or mapMatch().';

function renderingOf(
  replacement: Replacement,
  names: readonly (string | null)[],
): Projection | ((match: Match) => string) {
  switch (replacement?.kind) {
    case 'literal':
      if (typeof replacement.value !== 'string') break;
      return { open: replacement.value, copy: false, close: '' };
    case 'template': {
      if (typeof replacement.source !== 'string') break;
      const template = new Template(replacement.source, names);
      return template.projection() ?? ((match) => template.render(match));
    }
    case 'map':
      if (typeof replacement.apply !== 'function') break;
      return replacement.apply;
  }
  throw new TypeError(invalidReplacement);
}

export function compilePattern(
  pattern: string | RegExp,
  flags?: string,
): Pattern {
  const { source, flags: canonical, settings } = readSource(pattern, flags);
  const automaton = compile(parse(source, settings));

  function replacer(
    replacement: Replacement,
    options: MatchOptions = {},
  ): Session<string> {
    const rendering = renderingOf(replacement, automaton.captures);
    return guard(
      drive(
        automaton,
        limitOf(options),
        typeof rendering === 'function'
          ? mapping(rendering)
          : projecting(rendering),
      ),
    );
  }

  function matcher(options: MatchOptions = {}): Session<Segment[]> {
    return guard(drive(automaton, limitOf(options), segments()));
  }

  return { source, flags: canonical, matcher, replacer };
}
