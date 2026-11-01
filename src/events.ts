import type { Acceptance } from './program.js';
import { session, type Session } from './session.js';

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Match<Symbol> extends Span {
  readonly symbols: readonly Symbol[];
  readonly captures: ReadonlyMap<string, Span | null>;
}

export type Event<Symbol> =
  | {
      readonly kind: 'text';
      readonly start: number;
      readonly symbols: readonly Symbol[];
    }
  | { readonly kind: 'match'; readonly match: Match<Symbol> };

export type Matcher<Symbol> = Session<Iterable<Symbol>, Event<Symbol>[]>;

export type Replacement<Symbol> =
  | Iterable<Symbol>
  | ((match: Match<Symbol>) => Iterable<Symbol>);

export function match<Symbol>(
  acceptance: Acceptance,
  input: ReadonlyMap<number, Symbol>,
  names: readonly string[],
): Match<Symbol> {
  const { start, end, captures: slots } = acceptance;
  const symbols: Symbol[] = [];
  for (let index = start; index < end; index++) symbols.push(input.get(index)!);
  const captures = new Map<string, Span | null>();
  names.forEach((name, index) => {
    const start = slots[index * 2];
    const end = slots[index * 2 + 1];
    captures.set(name, start === null || end === null ? null : { start, end });
  });
  return { start, end, symbols, captures };
}

export type EventBuffer<Symbol> = (
  | {
      readonly kind: 'text';
      readonly start: number;
      readonly symbols: Symbol[];
    }
  | { readonly kind: 'match'; readonly match: Match<Symbol> }
)[];

export function appendText<Symbol>(
  events: EventBuffer<Symbol>,
  position: number,
  symbol: Symbol,
): void {
  const last = events[events.length - 1];
  if (last?.kind === 'text' && last.start + last.symbols.length === position)
    last.symbols.push(symbol);
  else events.push({ kind: 'text', start: position, symbols: [symbol] });
}

export function replace<Symbol>(
  matches: Matcher<Symbol>,
  replacement: Replacement<Symbol>,
): Session<Iterable<Symbol>, Symbol[]> {
  const substitute =
    typeof replacement === 'function' ? replacement : [...replacement];

  function render(events: readonly Event<Symbol>[]): Symbol[] {
    const output: Symbol[] = [];
    for (const event of events) {
      const symbols =
        event.kind === 'text'
          ? event.symbols
          : typeof substitute === 'function'
            ? substitute(event.match)
            : substitute;
      for (const symbol of symbols) output.push(symbol);
    }
    return output;
  }

  return session(
    (symbols) => render(matches.write(symbols)),
    () => render(matches.finish()),
  );
}
