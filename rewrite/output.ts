interface Link {
  readonly values: readonly number[];
  readonly next: Link | null;
}

export class Output {
  private front: Link | null = null;
  private back: Link | null = null;
  private offset = 0;

  fork(): Output {
    const output = new Output();
    output.front = this.front;
    output.back = this.back;
    output.offset = this.offset;
    return output;
  }

  append(values: readonly number[]): void {
    if (values.length > 0) this.back = { values, next: this.back };
  }

  peek(): number | undefined {
    if (this.front === null) {
      for (let link = this.back; link !== null; link = link.next) {
        this.front = { values: link.values, next: this.front };
      }
      this.back = null;
      this.offset = 0;
    }
    return this.front?.values[this.offset];
  }

  shift(): void {
    if (this.front === null) return;
    if (++this.offset === this.front.values.length) {
      this.front = this.front.next;
      this.offset = 0;
    }
  }
}
