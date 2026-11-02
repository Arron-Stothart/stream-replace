import type { Collector, Match } from './chunk-processor.ts';

export type Replacement =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'map'; readonly apply: (match: Match) => string };

interface Projection {
  readonly open: string;
  readonly copy: boolean;
  readonly close: string;
}

type Part =
  | string
  | { readonly kind: 'match' }
  | { readonly kind: 'group'; readonly index: number };

const references = /(\$(?:[$&`']|\d\d?))/;
const namedReferences = /(\$(?:[$&`']|\d\d?|<[^>]*>))/;

class Template {
  private readonly parts: readonly Part[];

  constructor(source: string, names: readonly (string | null)[]) {
    const named = names.some((name) => name !== null);
    const resolve = (token: string): readonly Part[] => {
      const body = token.slice(1);
      if (body === '$') return ['$'];
      if (body === '&') return [{ kind: 'match' }];
      if (body === '`' || body === "'")
        throw new SyntaxError(
          `$${body} is not supported, because it needs text from outside the match.`,
        );
      if (body.startsWith('<')) {
        const index = names.indexOf(body.slice(1, -1));
        return index < 0 ? [] : [{ kind: 'group', index }];
      }
      const digits =
        body.length === 2 && Number(body) > names.length ? body[0] : body;
      const rest = body.slice(digits.length);
      const index = Number(digits);
      return index >= 1 && index <= names.length
        ? [{ kind: 'group', index: index - 1 }, rest]
        : [`$${digits}`, rest];
    };
    this.parts = source
      .split(named ? namedReferences : references)
      .flatMap((piece, index) => (index % 2 === 0 ? [piece] : resolve(piece)));
  }

  projection(): Projection | null {
    const references = this.parts.filter((part) => typeof part !== 'string');
    if (
      references.length > 1 ||
      references.some((part) => part.kind === 'group')
    )
      return null;
    const split =
      references.length === 0
        ? this.parts.length
        : this.parts.indexOf(references[0]);
    return {
      open: this.parts.slice(0, split).join(''),
      copy: references.length === 1,
      close: this.parts.slice(split + 1).join(''),
    };
  }

  render(match: Match): string {
    return this.parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : part.kind === 'match'
            ? match.text
            : (match.captures[part.index] ?? ''),
      )
      .join('');
  }
}

class TextOutput {
  private readonly parts: string[] = [];

  readonly append = (text: string): void => {
    this.parts.push(text);
  };

  take(): string {
    return this.parts.splice(0).join('');
  }
}

function mapping(apply: (match: Match) => string): Collector<string> {
  const output = new TextOutput();
  return {
    text: output.append,
    match(match) {
      output.append(apply(match));
    },
    take: () => output.take(),
  };
}

function projecting({ open, copy, close }: Projection): Collector<string> {
  const output = new TextOutput();
  let opened = false;
  let copied = 0;
  const begin = (): void => {
    if (!opened) output.append(open);
    opened = true;
  };
  return {
    text: output.append,
    inside(text) {
      begin();
      if (copy) output.append(text);
      copied += text.length;
    },
    match({ text }) {
      begin();
      if (copy) output.append(text.slice(copied));
      output.append(close);
      opened = false;
      copied = 0;
    },
    take: () => output.take(),
  };
}

export function replacing(
  replacement: Replacement,
  names: readonly (string | null)[],
): Collector<string> {
  switch (replacement.kind) {
    case 'literal':
      return projecting({ open: replacement.value, copy: false, close: '' });
    case 'template': {
      const template = new Template(replacement.source, names);
      const projection = template.projection();
      return projection === null
        ? mapping((match) => template.render(match))
        : projecting(projection);
    }
    case 'map':
      return mapping(replacement.apply);
  }
}
