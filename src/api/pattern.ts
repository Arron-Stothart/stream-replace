import { Earliest } from '../engine/earliest/index.js';
import type { Projection } from '../engine/projection.js';
import { Scanner, type Sink } from '../engine/scanner.js';
import { automaton, type Automaton } from '../nfa/automaton.js';
import { compile } from '../nfa/compile.js';
import { parse } from '../syntax/parse.js';
import { readSource } from './dialect.js';
import { toMatch, type Match, type Segment } from './match.js';
import type { Replacement } from './replacement.js';
import { guard, type Session } from './session.js';
import { Template } from './template.js';

export interface ReplaceOptions {
  readonly earliest?: boolean;
}

export interface Pattern {
  readonly source: string;
  readonly flags: string;
  matcher(): Session<Segment[]>;
  replacer(replacement: Replacement, options?: ReplaceOptions): Session<string>;
}

function scan<Output>(
  automaton: Automaton,
  output: { sink: Sink; take(): Output },
): Session<Output> {
  const scanner = new Scanner(automaton, output.sink);
  return guard({
    write: (chunk) => (scanner.write(chunk), output.take()),
    finish: () => (scanner.finish(), output.take()),
  });
}

function writing(sink: (append: (text: string) => void) => Sink) {
  let output = '';
  return {
    sink: sink((text) => void (output += text)),
    take() {
      const result = output;
      output = '';
      return result;
    },
  };
}

function segments(names: readonly (string | null)[]) {
  let output: Segment[] = [];
  const sink: Sink = {
    text(text, start) {
      const last = output[output.length - 1];
      if (last?.kind === 'text' && last.end === start)
        output[output.length - 1] = {
          ...last,
          text: last.text + text,
          end: start + text.length,
        };
      else output.push({ kind: 'text', text, start, end: start + text.length });
    },
    progress() {},
    match(found) {
      output.push({ kind: 'match', ...toMatch(found, names) });
    },
  };
  return {
    sink,
    take() {
      const result = output;
      output = [];
      return result;
    },
  };
}

const mapping = (
  names: readonly (string | null)[],
  apply: (match: Match) => string,
) =>
  writing((append) => ({
    text: append,
    progress() {},
    match(found) {
      const replacement = apply(toMatch(found, names));
      if (typeof replacement !== 'string')
        throw new TypeError('A replacement function must return a string');
      append(replacement);
    },
  }));

const projecting = ({ open, inside, close }: Projection) =>
  writing((append) => {
    let written = -1;
    return {
      text: append,
      progress(_, text) {
        if (written < 0) {
          append(open);
          written = 0;
        }
        if (inside) append(text);
        written += text.length;
      },
      match({ text }) {
        if (written < 0) append(open);
        if (inside) append(text.slice(Math.max(written, 0)));
        append(close);
        written = -1;
      },
    };
  });

export function compilePattern(
  pattern: string | RegExp,
  flags?: string,
): Pattern {
  const { source, flags: canonical, options } = readSource(pattern, flags);
  const machine = automaton(compile(parse(source, options)));
  const names = machine.captures;
  const earliest = new Earliest(machine);

  function replacer(
    replacement: Replacement,
    { earliest: early = false }: ReplaceOptions = {},
  ): Session<string> {
    let projection: Projection | null;
    switch (replacement.kind) {
      case 'literal':
        projection = { open: replacement.value, inside: false, close: '' };
        break;
      case 'template': {
        const template = new Template(replacement.source, names);
        projection = template.projection();
        if (projection === null)
          return scan(
            machine,
            mapping(names, (match) => template.render(match)),
          );
        break;
      }
      case 'map':
        return scan(machine, mapping(names, replacement.apply));
    }
    const exact = early ? earliest.replace(projection) : null;
    return exact === null
      ? scan(machine, projecting(projection))
      : guard(exact);
  }

  return {
    source,
    flags: canonical,
    matcher: () => scan(machine, segments(names)),
    replacer,
  };
}
