const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

export class TextBuffer {
  private chunks: string[] = [];
  private offsets: number[] = [];
  private first = 0;
  private cursor = 0;
  private held = '';
  end = 0;

  append(chunk: string): void {
    const text = this.held + chunk;
    const hold = text.length > 0 && isHigh(text.charCodeAt(text.length - 1));
    this.held = hold ? text.slice(-1) : '';
    this.push(hold ? text.slice(0, -1) : text);
  }

  close(): void {
    this.push(this.held);
    this.held = '';
  }

  private push(text: string): void {
    if (text.length === 0) return;
    this.chunks.push(text);
    this.offsets.push(this.end);
    this.end += text.length;
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
      this.cursor -= first;
      first = 0;
    }
    this.first = first;
    this.cursor = Math.max(this.cursor, first);
  }

  private chunkAt(offset: number): number {
    let index = Math.min(this.cursor, this.chunks.length - 1);
    while (index > this.first && this.offsets[index] > offset) index--;
    while (index < this.chunks.length - 1 && this.offsets[index + 1] <= offset)
      index++;
    return (this.cursor = index);
  }

  private unit(offset: number): number {
    const index = this.chunkAt(offset);
    return this.chunks[index].charCodeAt(offset - this.offsets[index]);
  }

  codePointAt(offset: number): readonly [codePoint: number, length: number] {
    const unit = this.unit(offset);
    if (isHigh(unit) && offset + 1 < this.end) {
      const low = this.unit(offset + 1);
      if (isLow(low))
        return [0x10000 + ((unit - 0xd800) << 10) + low - 0xdc00, 2];
    }
    return [unit, 1];
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
