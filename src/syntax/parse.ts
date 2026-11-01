import { lineTerminators, wordCharacters, type Boundary } from './boundary.js';
import {
  complement,
  MAX_CODE_POINT,
  normalize,
  type Range,
} from './charset.js';
import type { Expression } from './expression.js';
import { caseFold, property } from './unicode.js';

export interface Flags {
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly dotAll: boolean;
}

const whitespace: readonly Range[] = [
  [9, 13],
  [32, 32],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

const controls: Readonly<Record<string, number>> = {
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
};

export function parse(source: string, flags: Flags): Expression {
  const input = Array.from(source);
  let position = 0;
  let groups = 0;
  const names = new Set<string>();
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at pattern position ${position}`);
  };
  const peek = (): string | undefined => input[position];
  const take = (): string | undefined => input[position++];
  const single = (character: string): Range[] => {
    const value = character.codePointAt(0)!;
    return [[value, value]];
  };

  function fold(values: readonly Range[]): readonly Range[] {
    const normalized = normalize(values);
    return flags.ignoreCase ? caseFold(normalized) : normalized;
  }

  const word = (): readonly Range[] => fold(wordCharacters);

  function hexadecimal(length: number | null): number {
    let text = '';
    if (length === null) {
      while (peek() !== '}' && peek() !== undefined) text += take();
      if (take() !== '}' || text.length === 0) fail('Invalid Unicode escape');
    } else for (let index = 0; index < length; index++) text += take() ?? '';
    if (
      !/^[\da-f]+$/i.test(text) ||
      (length !== null && text.length !== length)
    )
      fail('Invalid hexadecimal escape');
    const value = Number.parseInt(text, 16);
    if (value > MAX_CODE_POINT) fail('Code point out of range');
    return value;
  }

  function escaped(inClass: boolean): readonly Range[] {
    const character = take();
    if (character === undefined) return fail('Trailing escape');
    const lower = character.toLowerCase();
    if (lower === 'd' || lower === 's' || lower === 'w') {
      const values =
        lower === 'd'
          ? normalize([[48, 57]])
          : lower === 's'
            ? normalize(whitespace)
            : word();
      return character === lower ? values : complement(values);
    }
    if (lower === 'p') {
      if (take() !== '{') fail('Expected Unicode property name');
      let name = '';
      while (peek() !== '}' && peek() !== undefined) name += take();
      if (
        take() !== '}' ||
        !/^[A-Za-z_][A-Za-z_0-9]*(?:=[A-Za-z_][A-Za-z_0-9]*)?$/.test(name)
      )
        fail('Invalid Unicode property');
      const values = property(name);
      return character === 'p' ? values : complement(values);
    }
    if (character === 'x' || character === 'u') {
      const braced = character === 'u' && peek() === '{';
      if (braced) take();
      let value = hexadecimal(braced ? null : character === 'u' ? 4 : 2);
      if (!braced && character === 'u' && value >= 0xd800 && value <= 0xdbff) {
        const following = input.slice(position, position + 6).join('');
        const low = /^\\u([\da-f]{4})$/i.exec(following);
        const trail = low ? Number.parseInt(low[1], 16) : -1;
        if (trail >= 0xdc00 && trail <= 0xdfff) {
          position += 6;
          value = 0x10000 + ((value - 0xd800) << 10) + trail - 0xdc00;
        }
      }
      return [[value, value]];
    }
    if (character === 'c') {
      const letter = take();
      if (letter === undefined || !/^[A-Za-z]$/.test(letter))
        fail('Invalid control escape');
      const value = letter!.codePointAt(0)! % 32;
      return [[value, value]];
    }
    if (character in controls)
      return [[controls[character], controls[character]]];
    if (character === '0') {
      if (/\d/.test(peek() ?? '')) fail('Octal escapes are unsupported');
      return [[0, 0]];
    }
    if (character === 'b' && inClass) return [[8, 8]];
    if (character === '-' && inClass) return single('-');
    if (/^[\^$\\.*+?()[\]{}|/]$/.test(character)) return single(character);
    return fail(
      /^[1-9k]$/.test(character)
        ? 'Backreferences are unsupported'
        : 'Invalid escape',
    );
  }

  function characterClass(): Expression {
    const negated = peek() === '^';
    if (negated) take();
    const values: Range[] = [];
    function member(): readonly Range[] {
      const character = take();
      if (character === undefined) return fail('Unclosed character class');
      return character === '\\' ? escaped(true) : single(character);
    }
    while (peek() !== ']' && peek() !== undefined) {
      const left = member();
      if (
        peek() === '-' &&
        input[position + 1] !== ']' &&
        input[position + 1] !== undefined
      ) {
        take();
        const right = member();
        if (
          left.length !== 1 ||
          right.length !== 1 ||
          left[0][0] !== left[0][1] ||
          right[0][0] !== right[0][1] ||
          left[0][0] > right[0][0]
        )
          fail('Invalid character range');
        values.push([left[0][0], right[0][0]]);
      } else values.push(...left);
    }
    if (take() !== ']') fail('Unclosed character class');
    const set = fold(values);
    return { kind: 'chars', ranges: negated ? complement(set) : set };
  }

  const assert = (boundary: Boundary): Expression => ({
    kind: 'assert',
    boundary,
  });

  function atom(): Expression {
    const character = take();
    switch (character) {
      case '[':
        return characterClass();
      case '.':
        return {
          kind: 'chars',
          ranges: flags.dotAll
            ? [[0, MAX_CODE_POINT]]
            : complement(lineTerminators),
        };
      case '^':
        return assert({ kind: flags.multiline ? 'line-start' : 'start' });
      case '$':
        return assert({ kind: flags.multiline ? 'line-end' : 'end' });
      case '\\':
        if (peek() === 'b' || peek() === 'B')
          return assert({
            kind: 'word',
            negated: take() === 'B',
            word: word(),
          });
        return { kind: 'chars', ranges: fold(escaped(false)) };
      case undefined:
      case '*':
      case '+':
      case '?':
      case '{':
      case '}':
      case ']':
        return fail('Nothing to repeat or unbalanced bracket');
      default:
        return { kind: 'chars', ranges: fold(single(character)) };
    }
  }

  function count(): number {
    let digits = '';
    while (/\d/.test(peek() ?? '')) digits += take();
    return digits ? Number(digits) : Number.NaN;
  }

  function quantified(body: Expression): Expression {
    const operator = peek();
    if (operator === undefined || !'*+?{'.includes(operator)) return body;
    take();
    let minimum = operator === '+' ? 1 : 0;
    let maximum = operator === '?' ? 1 : Infinity;
    if (operator === '{') {
      minimum = maximum = count();
      if (Number.isNaN(minimum)) fail('Expected repetition count');
      if (peek() === ',') {
        take();
        const upper = count();
        maximum = Number.isNaN(upper) ? Infinity : upper;
      }
      if (take() !== '}') fail('Unclosed repetition count');
    }
    const greedy = peek() !== '?';
    if (!greedy) take();
    if (peek() !== undefined && '*+?{'.includes(peek()!))
      fail('Nothing to repeat');
    if (
      !Number.isSafeInteger(minimum) ||
      (maximum !== Infinity && !Number.isSafeInteger(maximum)) ||
      maximum < minimum
    )
      fail('Invalid repetition bounds');
    if (body.kind === 'assert') fail('Nothing to repeat');
    return { kind: 'repeat', body, minimum, maximum, greedy };
  }

  interface Group {
    readonly capture: number | null;
    readonly name: string | null;
    parts: Expression[];
    readonly alternatives: Expression[];
  }

  function close(group: Group): Expression {
    group.alternatives.push({ kind: 'sequence', parts: group.parts });
    const body: Expression =
      group.alternatives.length === 1
        ? group.alternatives[0]
        : { kind: 'choice', alternatives: group.alternatives };
    return group.capture === null
      ? body
      : { kind: 'capture', index: group.capture, name: group.name, body };
  }

  const stack: Group[] = [
    { capture: null, name: null, parts: [], alternatives: [] },
  ];
  while (peek() !== undefined) {
    const current = stack[stack.length - 1];
    const character = peek();
    if (character === '(') {
      take();
      let capture: number | null = groups;
      let name: string | null = null;
      if (peek() === '?') {
        take();
        const kind = take();
        if (kind === '<' && peek() !== '=' && peek() !== '!') {
          let label = '';
          while (peek() !== '>' && peek() !== undefined) label += take();
          if (
            take() !== '>' ||
            !/^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(label)
          )
            fail('Invalid capture name');
          if (names.has(label)) fail(`Duplicate capture name ${label}`);
          names.add(label);
          name = label;
        } else if (kind === ':') capture = null;
        else if (kind === '=' || kind === '!' || kind === '<')
          fail('Lookaround is unsupported');
        else fail('Unsupported group syntax');
      }
      if (capture !== null) groups++;
      stack.push({ capture, name, parts: [], alternatives: [] });
    } else if (character === ')') {
      take();
      if (stack.length === 1) fail('Unmatched closing parenthesis');
      const group = stack.pop()!;
      stack[stack.length - 1].parts.push(quantified(close(group)));
    } else if (character === '|') {
      take();
      current.alternatives.push({ kind: 'sequence', parts: current.parts });
      current.parts = [];
    } else current.parts.push(quantified(atom()));
  }
  if (stack.length !== 1) fail('Unclosed group');
  return close(stack[0]);
}
