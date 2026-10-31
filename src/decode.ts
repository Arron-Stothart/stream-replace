import { scalar } from './alphabet.js';

export function decode(text: string): number[] {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  const symbols = Array.from(text, (character) => character.codePointAt(0)!);
  if (symbols.some((value) => !scalar(value)))
    throw new TypeError('Unpaired UTF-16 surrogate');
  return symbols;
}

export class Decoder {
  private pending = '';

  write(chunk: string): number[] {
    if (typeof chunk !== 'string') throw new TypeError('Expected a text chunk');
    const input = this.pending + chunk;
    const last = input.charCodeAt(input.length - 1);
    const held = last >= 0xd800 && last <= 0xdbff;
    this.pending = held ? input.slice(-1) : '';
    return decode(held ? input.slice(0, -1) : input);
  }

  finish(): number[] {
    if (this.pending) throw new TypeError('Incomplete UTF-16 surrogate pair');
    return [];
  }
}

export function encode(symbols: readonly number[]): string {
  let result = '';
  for (let index = 0; index < symbols.length; index += 4096)
    result += String.fromCodePoint(...symbols.slice(index, index + 4096));
  return result;
}
