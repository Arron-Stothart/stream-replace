import { decode } from './decode.js';
import { complement, ranges, type Range } from './alphabet.js';
import { wordCharacters, lineCharacters } from './boundary.js';
import {
  boundary,
  capture,
  codepoints,
  quantify,
  repeat,
  type Expression,
} from './expression.js';

const space: readonly Range[] = [
  [9, 13],
  [32, 32],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];
const tables = new Map<string, readonly Range[]>();

function table(pattern: string, flags = 'u'): readonly Range[] {
  const key = `${flags}:${pattern}`;
  const cached = tables.get(key);
  if (cached) return cached;
  const expression = new RegExp(`^(?:${pattern})$`, flags);
  const result: Range[] = [];
  let start = -1;
  for (let value = 0; value <= 0x110000; value++) {
    const included =
      value < 0x110000 && expression.test(String.fromCodePoint(value));
    if (included && start < 0) start = value;
    if (!included && start >= 0) {
      result.push([start, value - 1]);
      start = -1;
    }
  }
  tables.set(key, result);
  return result;
}

export function parse(source: string, flags = ''): Expression<number> {
  if (/[^gimsu]/.test(flags) || new Set(flags).size !== flags.length)
    throw new SyntaxError('Unsupported or repeated regex flag');
  const input = decode(source).map((value) => String.fromCodePoint(value));
  let position = 0;
  let groups = 0;
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at pattern position ${position}`);
  };
  const peek = () => input[position];
  const take = () => input[position++];

  function folded(values: readonly Range[]): readonly Range[] {
    const normalized = ranges(values);
    if (!flags.includes('i') || normalized.length === 0) return normalized;
    const escape = (value: number) => `\\u{${value.toString(16)}}`;
    return table(
      `[${normalized.map(([a, b]) => (a === b ? escape(a) : `${escape(a)}-${escape(b)}`)).join('')}]`,
      'iu',
    );
  }

  function hexadecimal(length: number | null): number {
    let text = '';
    if (length === null) {
      while (peek() !== '}' && peek() !== undefined) text += take();
      if (take() !== '}' || text.length === 0 || text.length > 6)
        fail('Invalid Unicode escape');
    } else for (let index = 0; index < length; index++) text += take() ?? '';
    if (
      !/^[\da-f]+$/i.test(text) ||
      (length !== null && text.length !== length)
    )
      fail('Invalid hexadecimal escape');
    const value = Number.parseInt(text, 16);
    if (value > 0x10ffff) fail('Code point out of range');
    return value;
  }

  function escaped(): readonly Range[] {
    const character = take();
    if (character === undefined) return fail('Trailing escape');
    const lower = character.toLowerCase();
    if (lower === 'd' || lower === 's' || lower === 'w') {
      const values = folded(
        lower === 'd' ? [[48, 57]] : lower === 's' ? space : wordCharacters,
      );
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
      const values = folded(table(`\\p{${name}}`));
      return character === 'p' ? values : complement(values);
    }
    if (character === 'x' || character === 'u') {
      const braced = character === 'u' && peek() === '{';
      if (braced) take();
      let value = hexadecimal(braced ? null : character === 'u' ? 4 : 2);
      if (!braced && character === 'u' && value >= 0xd800 && value <= 0xdbff) {
        const following = input.slice(position, position + 6).join('');
        if (/^\\u[\da-f]{4}$/i.test(following)) {
          const low = Number.parseInt(following.slice(2), 16);
          if (low >= 0xdc00 && low <= 0xdfff) {
            position += 6;
            value = 0x10000 + ((value - 0xd800) << 10) + low - 0xdc00;
          }
        }
      }
      return [[value, value]];
    }
    const controls: Record<string, number> = {
      n: 10,
      r: 13,
      t: 9,
      f: 12,
      v: 11,
      b: 8,
      '0': 0,
    };
    if (character in controls) {
      if (character === '0' && /\d/.test(peek() ?? ''))
        fail('Octal escapes are unsupported');
      return [[controls[character], controls[character]]];
    }
    if (/^[A-Za-z0-9]$/.test(character))
      fail('Unsupported escape or backreference');
    return [[character.codePointAt(0)!, character.codePointAt(0)!]];
  }

  function characterClass(): Expression<number> {
    const negative = peek() === '^';
    if (negative) take();
    const values: Range[] = [];
    function member(): readonly Range[] {
      const character = take();
      if (character === undefined) return fail('Unclosed character class');
      return character === '\\'
        ? escaped()
        : [[character.codePointAt(0)!, character.codePointAt(0)!]];
    }
    while (peek() !== ']' && peek() !== undefined) {
      const left = member();
      if (peek() === '-' && input[position + 1] !== ']') {
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
    const normalized = folded(values);
    return codepoints(negative ? complement(normalized) : normalized);
  }

  function atom(): Expression<number> {
    const character = take();
    if (character === '[') return characterClass();
    if (character === '.')
      return codepoints(
        flags.includes('s') ? [[0, 0x10ffff]] : complement(lineCharacters),
      );
    if (character === '^')
      return boundary(flags.includes('m') ? 'line-start' : 'start');
    if (character === '$')
      return boundary(flags.includes('m') ? 'line-end' : 'end');
    if (character === '\\') {
      const names = { A: 'start', z: 'end', b: 'word', B: 'not-word' } as const;
      const next = peek();
      if (next !== undefined && Object.hasOwn(names, next))
        return boundary(
          names[take() as keyof typeof names],
          folded(wordCharacters),
        );
      return codepoints(folded(escaped()));
    }
    if (character === undefined || '*+?{}]'.includes(character))
      return fail('Unexpected metacharacter');
    return codepoints(
      folded([[character.codePointAt(0)!, character.codePointAt(0)!]]),
    );
  }

  function factor(body: Expression<number>): Expression<number> {
    const operator = peek();
    if (operator === undefined || !'*+?{'.includes(operator)) return body;
    take();
    let minimum = operator === '+' ? 1 : 0;
    let maximum = operator === '?' ? 1 : Infinity;
    if (operator === '{') {
      let lower = '';
      while (/\d/.test(peek() ?? '')) lower += take();
      if (!lower) fail('Expected repetition count');
      minimum = Number(lower);
      maximum = minimum;
      if (peek() === ',') {
        take();
        let upper = '';
        while (/\d/.test(peek() ?? '')) upper += take();
        maximum = upper ? Number(upper) : Infinity;
      }
      if (take() !== '}') fail('Unclosed repetition count');
    }
    const greedy = peek() !== '?';
    if (!greedy) take();
    if (peek() !== undefined && '*+?{'.includes(peek()))
      fail('Repeated quantifier');
    if (
      !Number.isSafeInteger(minimum) ||
      (maximum !== Infinity && !Number.isSafeInteger(maximum)) ||
      maximum < minimum
    )
      fail('Invalid repetition bounds');
    return minimum === 0 && maximum === Infinity
      ? repeat(body, greedy)
      : quantify(body, minimum, maximum, greedy);
  }

  interface Group {
    name: string | null;
    parts: Expression<number>[];
    alternatives: Expression<number>[];
  }

  function finish(group: Group): Expression<number> {
    group.alternatives.push({ kind: 'sequence', parts: group.parts });
    const body: Expression<number> =
      group.alternatives.length === 1
        ? group.alternatives[0]
        : { kind: 'choice', alternatives: group.alternatives };
    return group.name === null ? body : capture(group.name, body);
  }

  const stack: Group[] = [{ name: null, parts: [], alternatives: [] }];
  while (peek() !== undefined) {
    const current = stack[stack.length - 1];
    if (peek() === '(') {
      take();
      let name: string | null;
      if (peek() === '?') {
        take();
        if (peek() === ':') {
          take();
          name = null;
        } else if (peek() === '<') {
          take();
          name = '';
          while (peek() !== '>' && peek() !== undefined) name += take();
          if (take() !== '>' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))
            fail('Invalid capture name or unsupported lookbehind');
          groups++;
        } else return fail('Unsupported group construct');
      } else name = String(++groups);
      stack.push({ name, parts: [], alternatives: [] });
    } else if (peek() === ')') {
      take();
      if (stack.length === 1) fail('Unexpected closing group');
      const group = stack.pop()!;
      stack[stack.length - 1].parts.push(factor(finish(group)));
    } else if (peek() === '|') {
      take();
      current.alternatives.push({ kind: 'sequence', parts: current.parts });
      current.parts = [];
    } else current.parts.push(factor(atom()));
  }
  if (stack.length !== 1) fail('Unclosed group');
  return finish(stack[0]);
}
