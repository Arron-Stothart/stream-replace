import {
  caseFold,
  combineSurrogates,
  complement,
  digits,
  isHighSurrogate,
  isLowSurrogate,
  lineTerminators,
  MAX_CODE_POINT,
  normalize,
  property,
  whitespace,
  wordCharacters,
  type Boundary,
  type Range,
} from './alphabet.js';

export type Expression =
  | { readonly kind: 'chars'; readonly ranges: readonly Range[] }
  | { readonly kind: 'assert'; readonly boundary: Boundary }
  | { readonly kind: 'sequence'; readonly parts: readonly Expression[] }
  | { readonly kind: 'choice'; readonly alternatives: readonly Expression[] }
  | {
      readonly kind: 'repeat';
      readonly body: Expression;
      readonly minimum: number;
      readonly maximum: number;
      readonly greedy: boolean;
    }
  | {
      readonly kind: 'capture';
      readonly index: number;
      readonly name: string | null;
      readonly body: Expression;
    };

export interface Flags {
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly dotAll: boolean;
}

const controls: Readonly<Record<string, number>> = {
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
};

const quantifiers = '*+?{';

interface Group {
  readonly capture: number | null;
  readonly name: string | null;
  readonly alternatives: Expression[][];
}

export function parse(source: string, flags: Flags): Expression {
  const input = Array.from(source);
  const names = new Set<string>();
  let position = 0;
  let groups = 0;

  function fail(message: string): never {
    throw new SyntaxError(
      `${message} (near character ${position} of the pattern)`,
    );
  }

  const peek = (): string | undefined => input[position];
  const take = (): string | undefined => input[position++];

  function until(stop: string): string {
    const start = position;
    while (peek() !== stop && peek() !== undefined) position++;
    return input.slice(start, position).join('');
  }

  const single = (character: string): Range[] => {
    const value = character.codePointAt(0)!;
    return [[value, value]];
  };

  function fold(values: readonly Range[]): readonly Range[] {
    const normalized = normalize(values);
    return flags.ignoreCase ? caseFold(normalized) : normalized;
  }

  const word = (): readonly Range[] => fold(wordCharacters);

  function hexValue(text: string, problem: string): number {
    if (!/^[\da-f]+$/i.test(text)) fail(problem);
    const value = Number.parseInt(text, 16);
    if (value > MAX_CODE_POINT)
      fail('A \\u{...} escape cannot be larger than 10FFFF');
    return value;
  }

  function bracedHex(): number {
    const text = until('}');
    if (take() !== '}' || text === '')
      fail('A \\u{...} escape needs hex digits and a closing }');
    return hexValue(text, 'A \\u{...} escape may only contain hex digits');
  }

  function fixedHex(escape: 'x' | 'u'): number {
    const length = escape === 'x' ? 2 : 4;
    const text = input.slice(position, position + length).join('');
    position = Math.min(position + length, input.length);
    const problem = `A \\${escape} escape needs exactly ${length} hex digits`;
    if (text.length !== length) fail(problem);
    return hexValue(text, problem);
  }

  function unicodeEscape(): number {
    if (peek() === '{') {
      take();
      return bracedHex();
    }
    const value = fixedHex('u');
    if (!isHighSurrogate(value)) return value;
    const following = input.slice(position, position + 6).join('');
    const trail = /^\\u([\da-f]{4})$/i.exec(following);
    const low = trail === null ? -1 : Number.parseInt(trail[1], 16);
    if (!isLowSurrogate(low)) return value;
    position += 6;
    return combineSurrogates(value, low);
  }

  function knownProperty(name: string): readonly Range[] {
    try {
      return property(name);
    } catch {
      return fail(`\\p{${name}} is not a known Unicode property`);
    }
  }

  function propertyEscape(negated: boolean): readonly Range[] {
    if (take() !== '{')
      fail('Write \\p with a name in braces, like \\p{Letter}');
    const name = until('}');
    if (
      take() !== '}' ||
      !/^[A-Za-z_][A-Za-z_0-9]*(?:=[A-Za-z_][A-Za-z_0-9]*)?$/.test(name)
    )
      fail('A \\p{...} name may only use letters, digits, _ and one =');
    const values = knownProperty(name);
    return negated ? complement(values) : values;
  }

  function escaped(inClass: boolean): readonly Range[] {
    const character = take();
    if (character === undefined) fail('The pattern ends with a lone backslash');
    const lower = character.toLowerCase();
    if (lower === 'd' || lower === 's' || lower === 'w') {
      const values =
        lower === 'd'
          ? normalize(digits)
          : lower === 's'
            ? normalize(whitespace)
            : word();
      return character === lower ? values : complement(values);
    }
    if (lower === 'p') return propertyEscape(character === 'P');
    if (character === 'x' || character === 'u') {
      const value = character === 'x' ? fixedHex('x') : unicodeEscape();
      return [[value, value]];
    }
    if (character === 'c') {
      const letter = take();
      if (letter === undefined || !/^[A-Za-z]$/.test(letter))
        fail('\\c must be followed by a letter, like \\cJ');
      const value = letter.codePointAt(0)! % 32;
      return [[value, value]];
    }
    if (character in controls)
      return [[controls[character], controls[character]]];
    if (character === '0') {
      if (/\d/.test(peek() ?? ''))
        fail('Octal escapes like \\01 are not supported. Use \\x01 instead');
      return [[0, 0]];
    }
    if (character === 'b' && inClass) return [[8, 8]];
    if (character === '-' && inClass) return single('-');
    if (/^[\^$\\.*+?()[\]{}|/]$/.test(character)) return single(character);
    return fail(
      /^[1-9k]$/.test(character)
        ? 'Backreferences like \\1 and \\k<name> are not supported'
        : `\\${character} is not a valid escape`,
    );
  }

  function classMember(): readonly Range[] {
    const character = take();
    if (character === undefined) fail('A [ is never closed with ]');
    return character === '\\' ? escaped(true) : single(character);
  }

  function characterClass(): Expression {
    const negated = peek() === '^';
    if (negated) take();
    const values: Range[] = [];
    while (peek() !== ']' && peek() !== undefined) {
      const left = classMember();
      const isRange =
        peek() === '-' &&
        input[position + 1] !== ']' &&
        input[position + 1] !== undefined;
      if (!isRange) {
        values.push(...left);
        continue;
      }
      take();
      const right = classMember();
      if (
        left.length !== 1 ||
        right.length !== 1 ||
        left[0][0] !== left[0][1] ||
        right[0][0] !== right[0][1] ||
        left[0][0] > right[0][0]
      )
        fail('A range like [a-z] must go from one character to a later one');
      values.push([left[0][0], right[0][0]]);
    }
    if (take() !== ']') fail('A [ is never closed with ]');
    const set = fold(values);
    return { kind: 'chars', ranges: negated ? complement(set) : set };
  }

  const assert = (boundary: Boundary): Expression => ({
    kind: 'assert',
    boundary,
  });

  function atom(character: string): Expression {
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
      case '}':
      case ']':
        return fail(`A lone ${character} must be written as \\${character}`);
      default:
        if (quantifiers.includes(character))
          fail(`${character} has nothing before it to repeat`);
        return { kind: 'chars', ranges: fold(single(character)) };
    }
  }

  function count(): number | null {
    const start = position;
    while (/\d/.test(peek() ?? '')) position++;
    return position === start
      ? null
      : Number(input.slice(start, position).join(''));
  }

  function bounds(operator: string): readonly [number, number] {
    switch (operator) {
      case '*':
        return [0, Infinity];
      case '+':
        return [1, Infinity];
      case '?':
        return [0, 1];
    }
    const minimum = count();
    if (minimum === null)
      fail(
        'A { must start a count like {2} or {1,3}. To match { itself, write \\{',
      );
    const ranged = peek() === ',';
    if (ranged) take();
    const maximum = ranged ? (count() ?? Infinity) : minimum;
    if (take() !== '}') fail('A count like {1,3} is missing its closing }');
    return [minimum, maximum];
  }

  function quantified(body: Expression): Expression {
    const operator = peek();
    if (operator === undefined || !quantifiers.includes(operator)) return body;
    take();
    const [minimum, maximum] = bounds(operator);
    const greedy = peek() !== '?';
    if (!greedy) take();
    const following = peek();
    if (following !== undefined && quantifiers.includes(following))
      fail('Two repeat operators in a row, like a**, are not allowed');
    if (
      !Number.isSafeInteger(minimum) ||
      (maximum !== Infinity && !Number.isSafeInteger(maximum)) ||
      maximum < minimum
    )
      fail(
        'A count must be a whole number, and in {min,max} min cannot be more than max',
      );
    if (body.kind === 'assert') fail('^, $, \\b and \\B cannot be repeated');
    return { kind: 'repeat', body, minimum, maximum, greedy };
  }

  function groupName(): string {
    const label = until('>');
    if (
      take() !== '>' ||
      !/^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(label)
    )
      fail(
        'A group name like (?<name>...) must be a valid identifier ending with >',
      );
    if (names.has(label)) fail(`The group name ${label} is used twice`);
    names.add(label);
    return label;
  }

  function groupHeader(): { captures: boolean; name: string | null } {
    if (peek() !== '?') return { captures: true, name: null };
    take();
    const kind = take();
    if (kind === ':') return { captures: false, name: null };
    if (kind === '<' && peek() !== '=' && peek() !== '!')
      return { captures: true, name: groupName() };
    if (kind === '=' || kind === '!' || kind === '<')
      fail(
        'Lookahead and lookbehind, like (?=...) and (?<=...), are not supported',
      );
    return fail(
      `(?${kind ?? ''} is not supported. Only (?:...) and (?<name>...) groups are`,
    );
  }

  function close(group: Group): Expression {
    const branches = group.alternatives.map(
      (parts): Expression => ({ kind: 'sequence', parts }),
    );
    const body: Expression =
      branches.length === 1
        ? branches[0]
        : { kind: 'choice', alternatives: branches };
    return group.capture === null
      ? body
      : { kind: 'capture', index: group.capture, name: group.name, body };
  }

  const stack: Group[] = [{ capture: null, name: null, alternatives: [[]] }];
  for (let character = take(); character !== undefined; character = take()) {
    const current = stack[stack.length - 1];
    if (character === '(') {
      const { captures, name } = groupHeader();
      const capture = captures ? groups : null;
      if (captures) groups++;
      stack.push({ capture, name, alternatives: [[]] });
    } else if (character === ')') {
      if (stack.length === 1) fail('This ) has no matching (');
      const group = stack.pop()!;
      stack[stack.length - 1].alternatives
        .at(-1)!
        .push(quantified(close(group)));
    } else if (character === '|') current.alternatives.push([]);
    else current.alternatives.at(-1)!.push(quantified(atom(character)));
  }
  if (stack.length !== 1) fail('A ( is never closed with )');
  return close(stack[0]);
}
