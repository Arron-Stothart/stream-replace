import {
  appendText,
  match,
  replace,
  type EventBuffer,
  type Matcher,
  type Replacement,
} from './events.js';
import { machine } from './machine.js';
import type { Program } from './program.js';
import { Search } from './search.js';
import { session, type Session } from './session.js';

export function matcher<Symbol>(program: Program<Symbol>): Matcher<Symbol> {
  const search = new Search(machine(program));
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

  function pass(events: EventBuffer<Symbol>): void {
    appendText(events, position, input.get(position)!);
    release(position + 1);
  }

  function drain(events: EventBuffer<Symbol>, closed: boolean): void {
    while (true) {
      if (skipEmpty) {
        if (position === end) return;
        pass(events);
        skipEmpty = false;
      }
      const result = search.resume(input, end, closed, previous);
      if (result.kind === 'pending') return;
      if (result.kind === 'rejected') {
        if (position === end) return;
        pass(events);
        continue;
      }
      events.push({
        kind: 'match',
        match: match(result.match, input, program.captures),
      });
      skipEmpty = result.match.start === result.match.end;
      release(result.match.end);
    }
  }

  return session(
    (symbols) => {
      const events: EventBuffer<Symbol> = [];
      drain(events, false);
      for (const symbol of symbols) {
        input.set(end++, symbol);
        drain(events, false);
      }
      return events;
    },
    () => {
      const events: EventBuffer<Symbol> = [];
      drain(events, true);
      return events;
    },
  );
}

export const replacer = <Symbol>(
  program: Program<Symbol>,
  replacement: Replacement<Symbol>,
): Session<Iterable<Symbol>, Symbol[]> =>
  replace(matcher(program), replacement);
