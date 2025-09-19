import { randomBytes } from 'node:crypto';

const DEFAULT_PREFIX = 'eh';
const PREFIX_SANITIZE_REGEX = /[^a-zA-Z0-9]+/g;
const COUNTER_MAX = 36 ** 4;
const counters = new Map<string, number>();

function sanitizeSeed(seed?: string): string {
  if (typeof seed !== 'string') {
    return DEFAULT_PREFIX;
  }

  const trimmed = seed.trim();
  if (!trimmed) {
    return DEFAULT_PREFIX;
  }

  const normalized = trimmed.replace(PREFIX_SANITIZE_REGEX, '').toLowerCase();
  return normalized || DEFAULT_PREFIX;
}

function nextCounter(prefix: string): number {
  const current = counters.get(prefix) ?? 0;
  const next = (current + 1) % COUNTER_MAX;
  counters.set(prefix, next);
  return next;
}

function formatCounter(counter: number): string {
  return counter.toString(36).padStart(4, '0');
}

function randomSuffix(): string {
  return randomBytes(2).toString('hex');
}

export function genClOrdID(seed?: string): string {
  const prefix = sanitizeSeed(seed);
  const counter = nextCounter(prefix);
  const timestamp = Date.now().toString(36);
  const suffix = randomSuffix();

  return `${prefix}-${timestamp}-${formatCounter(counter)}${suffix}`;
}
