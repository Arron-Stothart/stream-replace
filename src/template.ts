import { decode, encode } from './decode.js';
import type { Match, Replacement } from './replace.js';

type Part = string | { readonly capture: string | null };

export function compileTemplate(
  source: string,
  names: readonly string[],
): Replacement<number> {
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
  if (parts.every((part) => typeof part === 'string'))
    return Array.from(parts.join(''), (char) => char.codePointAt(0)!);
  return (match: Match<number>) => {
    let output = '';
    for (const part of parts) {
      if (typeof part === 'string') output += part;
      else {
        const span =
          part.capture === null ? match : match.captures.get(part.capture);
        if (span)
          output += encode(
            match.symbols.slice(
              span.start - match.start,
              span.end - match.start,
            ),
          );
      }
    }
    return Array.from(output, (char) => char.codePointAt(0)!);
  };
}
