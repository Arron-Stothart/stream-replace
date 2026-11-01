export class TooLarge extends Error {}

export class Budget {
  private left: number;
  constructor(limit: number) {
    this.left = limit;
  }
  spend(cost: number): void {
    if ((this.left -= cost) < 0)
      throw new TooLarge('Pattern analysis exceeded its budget');
  }
}
