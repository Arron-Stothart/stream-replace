import type { Boundary, Context } from './boundary.js';

export interface Acceptance {
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (number | null)[];
}

export type Instruction<Symbol> =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | {
      readonly kind: 'assert';
      readonly accepts: (context: Context<Symbol>) => boolean | undefined;
      readonly boundary?: Boundary;
      readonly ranges?: readonly (readonly [number, number])[];
      readonly next: number;
    }
  | {
      readonly kind: 'consume';
      readonly accepts: (symbol: Symbol) => boolean;
      readonly next: number;
      readonly ranges?: readonly (readonly [number, number])[];
    }
  | {
      readonly kind: 'fork';
      readonly preferred: number;
      readonly fallback: number;
    }
  | { readonly kind: 'save'; readonly slot: number; readonly next: number }
  | { readonly kind: 'iterate'; readonly next: number }
  | { readonly kind: 'progress'; readonly next: number };

export interface Program<Symbol> {
  readonly entry: number;
  readonly instructions: readonly Instruction<Symbol>[];
  readonly captures: readonly string[];
}

export const thread = (instruction: number, progressed: boolean): number =>
  instruction * 2 + Number(progressed);

export const threadInstruction = (thread: number): number => thread >> 1;

export const threads = <Symbol>(program: Program<Symbol>): number =>
  program.instructions.length * 2;
