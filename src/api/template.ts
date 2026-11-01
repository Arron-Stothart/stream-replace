import type { Projection } from '../engine/projection.js';
import type { Match } from './match.js';

type Part = string | { readonly group: number };

const isDigit = (character: string | undefined) =>
  character !== undefined && character >= '0' && character <= '9';

export class Template {
  private readonly parts: readonly Part[];

  constructor(source: string, names: readonly (string | null)[]) {
    const named = names.some((name) => name !== null);
    const parts: Part[] = [];
    let text = '';
    const reference = (group: number) => {
      if (text) parts.push(text);
      text = '';
      parts.push({ group });
    };

    let position = 0;
    while (position < source.length) {
      const character = source[position];
      const next = source[position + 1];
      if (character !== '$' || next === undefined) {
        text += character;
        position++;
      } else if (next === '$') {
        text += '$';
        position += 2;
      } else if (next === '&') {
        reference(-1);
        position += 2;
      } else if (next === '`' || next === "'") {
        throw new SyntaxError(
          `$${next} refers to text outside the match, which a stream cannot provide`,
        );
      } else if (isDigit(next)) {
        let digits = isDigit(source[position + 2])
          ? source.slice(position + 1, position + 3)
          : next;
        if (digits.length === 2 && Number(digits) > names.length) digits = next;
        const index = Number(digits);
        if (index >= 1 && index <= names.length) reference(index - 1);
        else text += `$${digits}`;
        position += 1 + digits.length;
      } else if (next === '<' && named) {
        const close = source.indexOf('>', position + 2);
        if (close < 0) {
          text += '$<';
          position += 2;
        } else {
          const index = names.indexOf(source.slice(position + 2, close));
          if (index >= 0) reference(index);
          position = close + 1;
        }
      } else {
        text += '$';
        position++;
      }
    }
    if (text) parts.push(text);
    this.parts = parts;
  }

  projection(): Projection | null {
    const references = this.parts.filter((part) => typeof part !== 'string');
    if (references.length > 1 || references.some((part) => part.group !== -1))
      return null;
    const split =
      references.length === 0
        ? this.parts.length
        : this.parts.indexOf(references[0]);
    return {
      open: this.parts.slice(0, split).join(''),
      inside: references.length === 1,
      close: this.parts.slice(split + 1).join(''),
    };
  }

  render(match: Match): string {
    let result = '';
    for (const part of this.parts)
      result +=
        typeof part === 'string'
          ? part
          : part.group < 0
            ? match.text
            : (match.captures[part.group] ?? '');
    return result;
  }
}
