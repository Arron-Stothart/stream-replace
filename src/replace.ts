import { machine } from './machine.js';
import type { Acceptance, Program } from './program.js';
import { Search } from './search.js';
import { session, type Session } from './session.js';

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Match<Symbol> extends Span {
  readonly symbols: readonly Symbol[];
  readonly captures: ReadonlyMap<string, Span | null>;
}

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

export function replacer<Symbol>(
  program: Program<Symbol>,
  replacement: Replacement<Symbol>,
): Session<Iterable<Symbol>, Symbol[]> {
  const search = new Search(machine(program));
  const substitute =
    typeof replacement === 'function' ? replacement : [...replacement];
  const input = new Map<number, Symbol>();
  let position = 0;
  let end = 0;
  let previous: Symbol | undefined;
  let skipEmpty = false;

  function release(next: number): void {
    while (position < next) {
      previous = input.get(position);
      input.delete(position++);
    }
    search.restart(next);
  }

  function drain(output: Symbol[], closed: boolean): void {
    while (true) {
      if (skipEmpty) {
        if (position === end) return;
        output.push(input.get(position)!);
        release(position + 1);
        skipEmpty = false;
      }
      const result = search.resume(input, end, closed, previous);
      if (result.kind === 'pending') return;
      if (result.kind === 'rejected') {
        if (position === end) return;
        output.push(input.get(position)!);
        release(position + 1);
        continue;
      }
      const replacement =
        typeof substitute === 'function'
          ? substitute(match(result.match, input, program.captures))
          : substitute;
      for (const symbol of replacement) output.push(symbol);
      skipEmpty = result.match.start === result.match.end;
      release(result.match.end);
    }
  }

  return session(
    (symbols) => {
      const output: Symbol[] = [];
      drain(output, false);
      for (const symbol of symbols) {
        input.set(end++, symbol);
        drain(output, false);
      }
      return output;
    },
    () => {
      const output: Symbol[] = [];
      drain(output, true);
      return output;
    },
  );
}
