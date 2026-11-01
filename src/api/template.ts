export type Part = string | { readonly group: number };

export interface Projection {
  readonly open: string;
  readonly inside: boolean;
  readonly close: string;
}

const isDigit = (character: string | undefined) =>
  character !== undefined && character >= '0' && character <= '9';

export function parseTemplate(
  source: string,
  names: readonly string[],
): readonly Part[] {
  const named = names.some((name) => !isDigit(name[0]));
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
        const name = source.slice(position + 2, close);
        const index = isDigit(name[0]) ? -1 : names.indexOf(name);
        if (index >= 0) reference(index);
        position = close + 1;
      }
    } else {
      text += '$';
      position++;
    }
  }
  if (text) parts.push(text);
  return parts;
}

export function projection(parts: readonly Part[]): Projection | null {
  const references = parts.filter((part) => typeof part !== 'string');
  if (references.length > 1 || references.some((part) => part.group !== -1))
    return null;
  const split =
    references.length === 0 ? parts.length : parts.indexOf(references[0]);
  return {
    open: parts.slice(0, split).join(''),
    inside: references.length === 1,
    close: parts.slice(split + 1).join(''),
  };
}
