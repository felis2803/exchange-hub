import type { DomainUpdate } from '../../src/core/types.js';
import type { MetricLabels } from '../../src/infra/metrics.js';

import { getCounterValue, getHistogramValues } from '../../src/infra/metrics.js';

type KeyOf<T> = T extends Record<string, unknown> ? Extract<keyof T, string> : never;

export function expectChangedKeys<T extends Record<string, unknown>>(
  diff: DomainUpdate<T> | null | undefined,
  expected: readonly KeyOf<T>[],
): asserts diff is DomainUpdate<T> {
  if (!diff) {
    throw new Error('Expected diff to be defined');
  }

  const expectedSet = new Set(expected);
  const changedSet = new Set(diff.changed as readonly KeyOf<T>[]);

  expect(changedSet).toEqual(expectedSet);
}

export function expectChangedSubset<T extends Record<string, unknown>>(
  diff: DomainUpdate<T> | null | undefined,
  subset: readonly KeyOf<T>[],
): asserts diff is DomainUpdate<T> {
  if (!diff) {
    throw new Error('Expected diff to be defined');
  }

  const changedSet = new Set(diff.changed as readonly KeyOf<T>[]);
  for (const key of subset) {
    expect(changedSet.has(key)).toBe(true);
  }
}

export function expectNoChanges<T extends Record<string, unknown>>(
  diff: DomainUpdate<T> | null | undefined,
): void {
  if (!diff) {
    return;
  }

  expect(diff.changed).toHaveLength(0);
}

export function expectCounter(
  name: string,
  expected: number,
  labels?: MetricLabels,
): void {
  expect(getCounterValue(name, labels)).toBe(expected);
}

export function expectHistogramIncludes(
  name: string,
  expected: number,
  labels?: MetricLabels,
  tolerance = 1e-6,
): void {
  const values = getHistogramValues(name, labels);
  expect(values.some((value) => Math.abs(value - expected) <= tolerance)).toBe(true);
}

export function expectHistogramValues(
  name: string,
  expected: readonly number[],
  labels?: MetricLabels,
): void {
  expect(getHistogramValues(name, labels)).toEqual(expected);
}

