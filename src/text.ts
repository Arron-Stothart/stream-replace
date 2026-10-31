import { compile } from './compile.js';
import { Decoder, decode, encode } from './decode.js';
import { exactReplacer } from './exact.js';
import { parse } from './parse.js';
import type { Program } from './program.js';
import { replacer, type Match } from './replace.js';
import { session, type Session } from './session.js';
import { compileTemplate } from './template.js';
import type { TextReplacement } from './substitution.js';
export type { TextReplacement } from './substitution.js';
import { transducer, type Transducer } from './transducer.js';

export interface TextMatch {
  readonly text: string;
  readonly groups: readonly (string | undefined)[];
  readonly captures: ReadonlyMap<string, string | undefined>;
  readonly start: number;
  readonly end: number;
}

export interface TextReplacer extends Session<string, string> {
  readonly emission: 'earliest' | 'after-match';
}

export interface Pattern {
  readonly program: Program<number>;
  replacer(replacement: TextReplacement): TextReplacer;
}

export interface TextOptions {
  readonly pattern: string | RegExp | Pattern;
  readonly replacement: TextReplacement;
  readonly flags?: string;
}

function textMatch(match: Match<number>): TextMatch {
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
  return {
    text: encode(match.symbols),
    groups: [...captures.values()],
    captures,
    start: match.start,
    end: match.end,
  };
}

function textReplacer(
  processor: Session<Iterable<number>, number[]>,
  emission: 'earliest' | 'after-match',
): TextReplacer {
  const decoder = new Decoder();
  return {
    emission,
    ...session(
      (chunk: string) => encode(processor.write(decoder.write(chunk))),
      () =>
        encode(processor.write(decoder.finish())) + encode(processor.finish()),
    ),
  };
}

export function compilePattern(source: string, flags = ''): Pattern {
  const program = compile(parse(source, flags));
  const literals = new Map<string, Transducer>();
  return {
    program,
    replacer(replacement) {
      if (replacement.kind === 'callback') {
        return textReplacer(
          replacer(program, (match) =>
            decode(replacement.apply(textMatch(match))),
          ),
          'after-match',
        );
      }
      if (replacement.kind === 'template' && replacement.source === '$&') {
        return textReplacer(
          { write: (symbols) => [...symbols], finish: () => [] },
          'earliest',
        );
      }
      const parsed =
        replacement.kind === 'literal'
          ? decode(replacement.value)
          : compileTemplate(replacement.source, program.captures);
      if (typeof parsed === 'function')
        return textReplacer(replacer(program, parsed), 'after-match');
      const symbols = [...parsed];
      const key = encode(symbols);
      let machine = literals.get(key);
      if (machine === undefined) {
        machine = transducer(program, symbols);
        literals.set(key, machine);
      }
      return textReplacer(exactReplacer(machine), 'earliest');
    },
  };
}

export function resolvePattern(
  input: TextOptions['pattern'],
  flags = '',
): Pattern {
  if (typeof input === 'string') return compilePattern(input, flags);
  if (flags)
    throw new TypeError('Supply flags only when the pattern is a string');
  return input instanceof RegExp
    ? compilePattern(input.source, input.flags)
    : input;
}

export function replaceInStream({
  pattern,
  replacement,
  flags = '',
}: TextOptions): TransformStream<string, string> {
  const processor = resolvePattern(pattern, flags).replacer(replacement);
  return new TransformStream({
    transform(chunk, controller) {
      const output = processor.write(chunk);
      if (output) controller.enqueue(output);
    },
    flush(controller) {
      const output = processor.finish();
      if (output) controller.enqueue(output);
    },
  });
}
