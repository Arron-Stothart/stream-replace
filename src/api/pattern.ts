import { automaton, type Automaton } from '../nfa/automaton.js';
import { compile } from '../nfa/compile.js';
import { Scanner, type Sink } from '../engine/scanner.js';
import { TextBuffer } from '../engine/text.js';
import type { Acceptance } from '../engine/vm.js';
import { parse } from '../syntax/parse.js';
import { Earliest } from './earliest.js';
import type { TextMatch, TextReplacement } from './replacement.js';
import { guard, type Session } from './session.js';
import {
  parseTemplate,
  projection,
  type Part,
  type Projection,
} from './template.js';

export type TextEvent =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly start: number;
      readonly end: number;
    }
  | { readonly kind: 'match'; readonly match: TextMatch };

export type TextMatcher = Session<TextEvent[]>;
export type TextReplacer = Session<string>;

export interface ReplaceOptions {
  readonly earliest?: boolean;
}

export interface Pattern {
  readonly source: string;
  readonly flags: string;
  matcher(): TextMatcher;
  replacer(
    replacement: TextReplacement,
    options?: ReplaceOptions,
  ): TextReplacer;
}

function textMatch(
  buffer: TextBuffer,
  match: Acceptance,
  names: readonly string[],
): TextMatch {
  const groups = names.map((_, index) => {
    const start = match.slots[index * 2];
    const end = match.slots[index * 2 + 1];
    return start === null || end === null
      ? undefined
      : buffer.slice(start, end);
  });
  return {
    text: buffer.slice(match.start, match.end),
    start: match.start,
    end: match.end,
    groups,
    captures: new Map(names.map((name, index) => [name, groups[index]])),
  };
}

interface Collector<Output> {
  readonly sink: Sink;
  take(): Output;
}

function scan<Output>(
  automaton: Automaton,
  collector: (buffer: TextBuffer) => Collector<Output>,
): Session<Output> {
  const buffer = new TextBuffer();
  const { sink, take } = collector(buffer);
  const scanner = new Scanner(automaton, buffer, sink);
  return guard({
    write: (chunk) => (scanner.write(chunk), take()),
    finish: () => (scanner.finish(), take()),
  });
}

function events(names: readonly string[]) {
  return (buffer: TextBuffer): Collector<TextEvent[]> => {
    let output: TextEvent[] = [];
    return {
      sink: {
        text(from, to) {
          const last = output[output.length - 1];
          const text = buffer.slice(from, to);
          if (last?.kind === 'text' && last.end === from)
            output[output.length - 1] = {
              kind: 'text',
              text: last.text + text,
              start: last.start,
              end: to,
            };
          else output.push({ kind: 'text', text, start: from, end: to });
        },
        progress() {},
        match(match) {
          output.push({
            kind: 'match',
            match: textMatch(buffer, match, names),
          });
        },
      },
      take: () => {
        const result = output;
        output = [];
        return result;
      },
    };
  };
}

function substitute(
  names: readonly string[],
  apply: (match: TextMatch) => string,
) {
  return (buffer: TextBuffer): Collector<string> => {
    let output = '';
    return {
      sink: {
        text: (from, to) => void (output += buffer.slice(from, to)),
        progress() {},
        match: (match) => {
          const replacement = apply(textMatch(buffer, match, names));
          if (typeof replacement !== 'string')
            throw new TypeError('A replacement callback must return a string');
          output += replacement;
        },
      },
      take: () => {
        const result = output;
        output = '';
        return result;
      },
    };
  };
}

function project({ open, inside, close }: Projection) {
  return (buffer: TextBuffer): Collector<string> => {
    let output = '';
    let written = -1;
    const advance = (start: number, to: number) => {
      if (written < 0) {
        output += open;
        written = start;
      }
      if (inside) output += buffer.slice(written, to);
      written = to;
    };
    return {
      sink: {
        text: (from, to) => void (output += buffer.slice(from, to)),
        progress: advance,
        match: ({ start, end }) => {
          advance(start, end);
          output += close;
          written = -1;
        },
      },
      take: () => {
        const result = output;
        output = '';
        return result;
      },
    };
  };
}

function render(parts: readonly Part[]) {
  return (match: TextMatch): string =>
    parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : part.group < 0
            ? match.text
            : (match.groups[part.group] ?? ''),
      )
      .join('');
}

function readFlags(flags: string) {
  if (/[^dgimsu]/.test(flags) || new Set(flags).size !== flags.length)
    throw new SyntaxError(`Unsupported or repeated flags: ${flags}`);
  return {
    ignoreCase: flags.includes('i'),
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
  };
}

export function compilePattern(
  pattern: string | RegExp,
  flags?: string,
): Pattern {
  let source: string;
  if (pattern instanceof RegExp) {
    if (flags !== undefined)
      throw new TypeError('Pass flags only with a string pattern');
    if (!pattern.unicode)
      throw new SyntaxError(
        'A RegExp pattern needs the u flag; without it JavaScript matches UTF-16 code units',
      );
    ({ source, flags } = pattern);
  } else source = pattern;
  flags ??= '';
  const machine = automaton(compile(parse(source, readFlags(flags))));
  const names = machine.captures;
  const earliest = new Earliest(machine);

  return {
    source,
    flags,
    matcher: () => scan(machine, events(names)),
    replacer(replacement, options = {}) {
      let shape: Projection | null;
      let apply: (match: TextMatch) => string;
      switch (replacement.kind) {
        case 'literal':
          shape = { open: replacement.value, inside: false, close: '' };
          apply = () => replacement.value;
          break;
        case 'template': {
          const parts = parseTemplate(replacement.source, names);
          shape = projection(parts);
          apply = render(parts);
          break;
        }
        case 'callback':
          shape = null;
          apply = replacement.apply;
          break;
      }
      if (shape === null) return scan(machine, substitute(names, apply));
      const exact = options.earliest ? earliest.replacer(shape) : null;
      return exact ?? scan(machine, project(shape));
    },
  };
}
