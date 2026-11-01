import { compile } from './automaton.ts';
import { Earliest } from './earliest.ts';
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

export interface ReplaceOptions extends MatchOptions {
  readonly earliest?: boolean;
}

export interface Pattern {
  readonly source: string;
  readonly flags: string;
  matcher(options?: MatchOptions): Session<Segment[]>;
  replacer(replacement: Replacement, options?: ReplaceOptions): Session<string>;
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

function earliestOf({ earliest = false }: ReplaceOptions): boolean {
  if (typeof earliest !== 'boolean')
    throw new TypeError('The earliest option must be true or false.');
  return earliest;
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
  const earliest = new Earliest(automaton);

  function replacer(
    replacement: Replacement,
    options: ReplaceOptions = {},
  ): Session<string> {
    const limit = limitOf(options);
    const early = earliestOf(options);
    const rendering = renderingOf(replacement, automaton.captures);
    if (!early)
      return guard(
        drive(
          automaton,
          limit,
          typeof rendering === 'function'
            ? mapping(rendering)
            : projecting(rendering),
        ),
      );
    if (limit !== Infinity)
      throw new TypeError(
        'The earliest option cannot be used together with maxMatchLength.',
      );
    if (typeof rendering === 'function')
      throw new TypeError(
        'The earliest option only works with literal(), or with a template whose only reference is $&.',
      );
    return guard(earliest.replace(rendering));
  }

  function matcher(options: MatchOptions = {}): Session<Segment[]> {
    if ('earliest' in options)
      throw new TypeError('The earliest option only applies to replacer().');
    return guard(drive(automaton, limitOf(options), segments()));
  }

  return { source, flags: canonical, matcher, replacer };
}
