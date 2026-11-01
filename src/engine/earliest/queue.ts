interface Link<Value> {
  readonly values: readonly Value[];
  readonly next: Link<Value> | null;
}

export class Queue<Value> {
  private front: Link<Value> | null = null;
  private back: Link<Value> | null = null;
  private offset = 0;

  fork(): Queue<Value> {
    const queue = new Queue<Value>();
    queue.front = this.front;
    queue.back = this.back;
    queue.offset = this.offset;
    return queue;
  }

  append(values: readonly Value[]): void {
    if (values.length > 0) this.back = { values, next: this.back };
  }

  peek(): Value | undefined {
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
