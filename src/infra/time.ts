import { TimestampISO } from '../core/types.js';

export function toIso(input: number | Date): TimestampISO {
  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  return date.toISOString();
}

export function parseIsoTs(value: string): number {
  return Date.parse(value);
}

export function isNewerByTimestamp(prevIso?: string, nextIso?: string): boolean {
  if (!nextIso) {
    return false;
  }
  if (!prevIso) {
    return true;
  }
  return parseIsoTs(nextIso) >= parseIsoTs(prevIso);
}

export function normalizeWsTs(ts?: string | number): TimestampISO | undefined {
  if (ts === undefined || ts === null) {
    return undefined;
  }

  if (typeof ts === 'number') {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const trimmed = ts.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const numericDate = new Date(numeric);
      return Number.isNaN(numericDate.getTime()) ? undefined : numericDate.toISOString();
    }
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
