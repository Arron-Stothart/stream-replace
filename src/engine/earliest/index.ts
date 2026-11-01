import type { Automaton } from '../../nfa/automaton.js';
import type { Projection } from '../projection.js';
import { holdBack } from '../text.js';
import { Budget, TooLarge } from './budget.js';
import type { Graph } from './graph.js';
import { markMatches, type Mark } from './marks.js';
import { project } from './project.js';
import { Simulation } from './simulation.js';

const BUDGET = 2_000_000;

export interface Replacing {
  write(chunk: string): string;
  finish(): string;
}

function encode(symbols: readonly number[]): string {
  let result = '';
  for (let index = 0; index < symbols.length; index += 4096)
    result += String.fromCodePoint(...symbols.slice(index, index + 4096));
  return result;
}

export class Earliest {
  private readonly automaton: Automaton;
  private marks: Graph<Mark> | 'too-large' | null = null;

  constructor(automaton: Automaton) {
    this.automaton = automaton;
  }

  replace(projection: Projection): Replacing | null {
    try {
      this.marks ??= markMatches(this.automaton, new Budget(BUDGET));
      if (this.marks === 'too-large') return null;
      return replacing(
        new Simulation(project(this.marks, projection, new Budget(BUDGET))),
      );
    } catch (error) {
      if (!(error instanceof TooLarge)) throw error;
      this.marks ??= 'too-large';
      return null;
    }
  }
}

function replacing(simulation: Simulation): Replacing {
  let pending = encode(simulation.start());
  let held = '';
  const read = (text: string): string => {
    const output: number[] = [];
    for (const character of text)
      simulation.read(character.codePointAt(0)!, output);
    const result = pending + encode(output);
    pending = '';
    return result;
  };
  return {
    write(chunk) {
      let ready: string;
      [ready, held] = holdBack(held + chunk);
      return read(ready);
    },
    finish() {
      const output = read(held);
      const rest: number[] = [];
      simulation.finish(rest);
      return output + encode(rest);
    },
  };
}
