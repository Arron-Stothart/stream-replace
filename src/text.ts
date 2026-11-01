import {
  combineSurrogates,
  isHighSurrogate,
  isLowSurrogate,
  lastAtOrBelow,
} from './alphabet.ts';

const LOOKBEHIND_UNITS = 2;
const COMPACT_AFTER = 64;

export class TextBuffer {
  private chunks: string[] = [];
  private offsets: number[] = [];
  private first = 0;
  private cursor = 0;
  private held = '';
  private endOffset = 0;
  private isClosed = false;

  get end(): number {
    return this.endOffset;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  append(chunk: string): void {
    const text = this.held + chunk;
    const split =
      text.length > 0 && isHighSurrogate(text.charCodeAt(text.length - 1))
        ? text.length - 1
        : text.length;
    this.held = text.slice(split);
    this.push(text.slice(0, split));
  }

  close(): void {
    this.push(this.held);
    this.held = '';
    this.isClosed = true;
  }

  private push(text: string): void {
    if (text.length === 0) return;
    this.chunks.push(text);
    this.offsets.push(this.endOffset);
    this.endOffset += text.length;
  }

  release(offset: number): void {
    const first = Math.max(
      this.first,
      lastAtOrBelow(this.offsets, offset - LOOKBEHIND_UNITS, this.first),
    );
    this.chunks.fill('', this.first, first);
    if (first > COMPACT_AFTER && first * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(first);
      this.offsets = this.offsets.slice(first);
      this.cursor = Math.max(0, this.cursor - first);
      this.first = 0;
    } else this.first = first;
    this.cursor = Math.max(this.cursor, this.first);
  }

  private chunkAt(offset: number): number {
    const { offsets } = this;
    const last = offsets.length - 1;
    const index = Math.min(this.cursor, last);
    if (
      offsets[index] <= offset &&
      (index === last || offsets[index + 1] > offset)
    )
      return index;
    if (
      index < last &&
      offsets[index + 1] <= offset &&
      (index + 1 === last || offsets[index + 2] > offset)
    )
      return (this.cursor = index + 1);
    return (this.cursor = Math.max(
      this.first,
      lastAtOrBelow(offsets, offset, this.first),
    ));
  }

  private unit(offset: number): number {
    const index = this.chunkAt(offset);
    return this.chunks[index].charCodeAt(offset - this.offsets[index]);
  }

  codePointAt(offset: number): number {
    const unit = this.unit(offset);
    if (!isHighSurrogate(unit) || offset + 1 >= this.endOffset) return unit;
    const low = this.unit(offset + 1);
    return isLowSurrogate(low) ? combineSurrogates(unit, low) : unit;
  }

  codePointBefore(offset: number): number | undefined {
    if (offset === 0) return undefined;
    const unit = this.unit(offset - 1);
    if (!isLowSurrogate(unit) || offset < 2) return unit;
    const high = this.unit(offset - 2);
    return isHighSurrogate(high) ? combineSurrogates(high, unit) : unit;
  }

  slice(from: number, to: number): string {
    if (from >= to) return '';
    const first = this.chunkAt(from);
    const base = this.offsets[first];
    if (to - base <= this.chunks[first].length)
      return this.chunks[first].slice(from - base, to - base);
    const parts: string[] = [];
    for (let index = first; index < this.chunks.length; index++) {
      const base = this.offsets[index];
      if (base >= to) break;
      parts.push(this.chunks[index].slice(Math.max(from - base, 0), to - base));
    }
    return parts.join('');
  }
}
