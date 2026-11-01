const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

export const width = (codePoint: number): number =>
  codePoint > 0xffff ? 2 : 1;

export function holdBack(text: string): readonly [ready: string, held: string] {
  return text.length > 0 && isHigh(text.charCodeAt(text.length - 1))
    ? [text.slice(0, -1), text.slice(-1)]
    : [text, ''];
}

export class TextBuffer {
  private chunks: string[] = [];
  private offsets: number[] = [];
  private first = 0;
  private cursor = 0;
  private held = '';
  private length = 0;

  get end(): number {
    return this.length;
  }

  append(chunk: string): void {
    const [ready, held] = holdBack(this.held + chunk);
    this.held = held;
    this.push(ready);
  }

  close(): void {
    this.push(this.held);
    this.held = '';
  }

  private push(text: string): void {
    if (text.length === 0) return;
    this.chunks.push(text);
    this.offsets.push(this.length);
    this.length += text.length;
  }

  release(offset: number): void {
    let first = this.first;
    while (
      first < this.chunks.length - 1 &&
      this.offsets[first + 1] <= offset - 2
    )
      first++;
    if (first > 64 && first * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(first);
      this.offsets = this.offsets.slice(first);
      this.cursor = Math.max(0, this.cursor - first);
      first = 0;
    }
    this.first = first;
    this.cursor = Math.max(this.cursor, first);
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
    let low = this.first;
    let high = last;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (offsets[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return (this.cursor = low);
  }

  private unit(offset: number): number {
    const index = this.chunkAt(offset);
    return this.chunks[index].charCodeAt(offset - this.offsets[index]);
  }

  codePointAt(offset: number): number {
    const unit = this.unit(offset);
    if (isHigh(unit) && offset + 1 < this.length) {
      const low = this.unit(offset + 1);
      if (isLow(low)) return 0x10000 + ((unit - 0xd800) << 10) + low - 0xdc00;
    }
    return unit;
  }

  codePointBefore(offset: number): number | undefined {
    if (offset === 0) return undefined;
    const unit = this.unit(offset - 1);
    if (isLow(unit) && offset >= 2) {
      const high = this.unit(offset - 2);
      if (isHigh(high))
        return 0x10000 + ((high - 0xd800) << 10) + unit - 0xdc00;
    }
    return unit;
  }

  slice(from: number, to: number): string {
    if (from >= to) return '';
    let result = '';
    for (let index = this.chunkAt(from); index < this.chunks.length; index++) {
      const base = this.offsets[index];
      if (base >= to) break;
      result += this.chunks[index].slice(Math.max(from - base, 0), to - base);
    }
    return result;
  }
}
