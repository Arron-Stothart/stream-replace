export interface Saved {
  readonly slot: number;
  readonly position: number;
  readonly previous: Saved | null;
}

export function slots(saved: Saved | null, count: number): (number | null)[] {
  const result = Array<number | null>(count * 2).fill(null);
  for (let entry = saved; entry !== null; entry = entry.previous)
    result[entry.slot] ??= entry.position;
  return result;
}
