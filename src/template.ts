import { decode } from './decode.js';
import type { TextMatch } from './substitution.js';
import type { Projection } from './transducer.js';

type Part = string | { readonly capture: string | null };

export type CompiledTemplate =
  | { readonly kind: 'projection'; readonly projection: Projection }
  | { readonly kind: 'function'; readonly apply: (match: TextMatch) => string };

function projection(parts: readonly Part[]): Projection | null {
  const whole = parts.filter((part) => typeof part !== 'string');
  if (whole.length > 1 || whole.some((part) => part.capture !== null))
    return null;
  const split = whole.length === 0 ? parts.length : parts.indexOf(whole[0]);
  const text = (from: number, to: number): number[] =>
    decode(parts.slice(from, to).join(''));
  return {
    open: text(0, split),
    inside: whole.length === 1,
    close: text(split + 1, parts.length),
  };
}

export function compileTemplate(
  source: string,
  names: readonly string[],
): CompiledTemplate {
  decode(source);
  const parts: Part[] = [];
  let literal = '';
  let position = 0;
  while (position < source.length) {
    const character = source[position++];
    if (character !== '$' || position === source.length) {
      literal += character;
      continue;
    }
    const next = source[position];
    if (next === '$') {
      literal += '$';
      position++;
      continue;
    }
    let name: string | null;
    if (next === '&') {
      name = null;
      position++;
    } else if (/\d/.test(next)) {
      let digits = '';
      while (/\d/.test(source[position] ?? '')) digits += source[position++];
      const index = Number(digits);
      if (index < 1 || index > names.length)
        throw new SyntaxError(`Unknown capture $${digits}`);
      name = names[index - 1];
    } else if (next === '<' || next === '{') {
      position++;
      const end = source.indexOf(next === '<' ? '>' : '}', position);
      if (end < 0) throw new SyntaxError('Unclosed replacement capture');
      name = source.slice(position, end);
      if (!names.includes(name))
        throw new SyntaxError(`Unknown capture ${name}`);
      position = end + 1;
    } else {
      literal += '$';
      continue;
    }
    if (literal) {
      parts.push(literal);
      literal = '';
    }
    parts.push({ capture: name });
  }
  if (literal) parts.push(literal);
  const projected = projection(parts);
  if (projected !== null) return { kind: 'projection', projection: projected };
  return {
    kind: 'function',
    apply: (match) =>
      parts
        .map((part) =>
          typeof part === 'string'
            ? part
            : part.capture === null
              ? match.text
              : (match.captures.get(part.capture) ?? ''),
        )
        .join(''),
  };
}
