/**
 * Note: JSON.stringify is used for comparisons, so objects with equal semantic content but different
 * key ordering will be considered changed. This behavior is intentional, covered by tests, and
 * sufficient for the current diff granularity.
 */
export function diffKeys<T extends Record<string, unknown>>(prev: T, next: T): (keyof T)[] {
  const keys = new Set<keyof T>();
  for (const key of Object.keys(prev) as (keyof T)[]) {
    keys.add(key);
  }
  for (const key of Object.keys(next) as (keyof T)[]) {
    keys.add(key);
  }

  const changed: (keyof T)[] = [];
  for (const key of keys) {
    const prevValue = prev[key];
    const nextValue = next[key];
    const prevSerialized = JSON.stringify(prevValue);
    const nextSerialized = JSON.stringify(nextValue);
    if (prevSerialized !== nextSerialized) {
      changed.push(key);
    }
  }

  return changed;
}
