import { Position } from '../../../domain/position.js';
import type { PositionSnapshot, PositionUpdate, PositionUpdateReason } from '../../../domain/position.js';
import { createLogger, LOG_TAGS } from '../../../infra/logger.js';
import { isNewerByTimestamp, normalizeWsTs } from '../../../infra/time.js';

import type { AccountId, Symbol as TradingSymbol, TimestampISO } from '../../types.js';
import type { BitMex } from '../index.js';
import type { BitMexChannelMessage } from '../types.js';
import type { BitMexPosition } from '../types.js';

const log = createLogger('bitmex:position').withTags([
  LOG_TAGS.ws,
  LOG_TAGS.private,
  LOG_TAGS.position,
]);

type PositionMessage = BitMexChannelMessage<'position'>;

type NormalizedSnapshotEntry = {
  accountId: AccountId;
  symbol: TradingSymbol;
  snapshot: PositionSnapshot;
};

type NormalizedUpdateEntry = {
  accountId: AccountId;
  symbol: TradingSymbol;
  update: PositionUpdate;
};

export function handlePositionMessage(core: BitMex, message: PositionMessage): void {
  const { action, data } = message;

  switch (action) {
    case 'partial':
      handlePositionPartial(core, data);
      break;
    case 'insert':
      handlePositionInsert(core, data);
      break;
    case 'update':
      handlePositionUpdate(core, data);
      break;
    case 'delete':
      handlePositionDelete(core, data);
      break;
    default:
      break;
  }
}

export function handlePositionPartial(core: BitMex, rows: BitMexPosition[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const grouped = groupSnapshots(rows);
  const positions = core.shell.positions;

  for (const [accountId, entries] of grouped.entries()) {
    const seen = new Set<string>();

    for (const entry of entries) {
      const { symbol, snapshot } = entry;
      const key = makeKey(accountId, symbol);
      seen.add(key);

      let position = positions.get(accountId, symbol);

      if (!position) {
        position = new Position(createBaseSnapshot(accountId, symbol));
        positions.add(position);
      }

      const changed = position.reset(snapshot, 'partial');

      const symbolLog = log.withTags(['symbol']);

      if (changed) {
        symbolLog.debug('BitMEX position partial applied for %s/%s', accountId, symbol, {
          accountId,
          symbol,
        });
      }

      if (position.size === 0) {
        positions.remove(position);
        symbolLog.debug('BitMEX position partial removed empty %s/%s', accountId, symbol, {
          accountId,
          symbol,
        });
      }
    }

    const existingPositions = positions.byAccount(accountId);

    for (const position of existingPositions) {
      const key = makeKey(accountId, position.symbol);

      if (seen.has(key)) {
        continue;
      }

      position.update({ currentQty: 0, size: 0, side: 'buy' }, 'partial', {
        allowOlderTimestamp: true,
      });
      positions.remove(position);

      log
        .withTags(['symbol', LOG_TAGS.reconnect])
        .info('BitMEX position partial removed stale %s/%s', accountId, position.symbol, {
          accountId,
          symbol: position.symbol,
        });
    }
  }
}

export function handlePositionInsert(core: BitMex, rows: BitMexPosition[]): void {
  applyIncrementalUpdates(core, rows, 'insert');
}

export function handlePositionUpdate(core: BitMex, rows: BitMexPosition[]): void {
  applyIncrementalUpdates(core, rows, 'update');
}

export function handlePositionDelete(core: BitMex, rows: BitMexPosition[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const positions = core.shell.positions;

  for (const raw of rows) {
    const accountId = normalizeAccount(raw.account);
    const symbol = normalizeSymbol(raw.symbol);

    if (!accountId || !symbol) {
      continue;
    }

    const position = positions.get(accountId, symbol);

    if (!position) {
      continue;
    }

    const timestamp = normalizeTimestamp(raw.timestamp);
    const update: PositionUpdate = { currentQty: 0, size: 0, side: 'buy' };

    if (timestamp !== undefined) {
      update.timestamp = timestamp;
    }

    position.update(update, 'delete', { allowOlderTimestamp: true });
    positions.remove(position);

    log.withTags(['symbol']).debug('BitMEX position delete removed %s/%s', accountId, symbol, {
      accountId,
      symbol,
    });
  }
}

function applyIncrementalUpdates(core: BitMex, rows: BitMexPosition[], reason: PositionUpdateReason): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const updates = groupUpdates(rows);
  const positions = core.shell.positions;

  for (const entry of updates.values()) {
    const { accountId, symbol, update } = entry;

    let position = positions.get(accountId, symbol);

    if (!position) {
      position = new Position(createBaseSnapshot(accountId, symbol));
      positions.add(position);
    }

    const applied = position.update(update, reason, { allowOlderTimestamp: reason === 'insert' });

    if (!applied) {
      continue;
    }

    const snapshot = position.getSnapshot();
    const symbolLog = log.withTags(['symbol']);

    symbolLog.debug('BitMEX position %s applied for %s/%s', reason, accountId, symbol, {
      accountId,
      symbol,
      reason,
    });

    if (snapshot.size === 0) {
      positions.remove(position);
      symbolLog.debug('BitMEX position %s removed empty %s/%s', reason, accountId, symbol, {
        accountId,
        symbol,
        reason,
      });
    }
  }
}

function groupSnapshots(rows: BitMexPosition[]): Map<AccountId, NormalizedSnapshotEntry[]> {
  const grouped = new Map<AccountId, Map<string, NormalizedSnapshotEntry>>();

  for (const raw of rows) {
    const accountId = normalizeAccount(raw.account);
    const symbol = normalizeSymbol(raw.symbol);

    if (!accountId || !symbol) {
      continue;
    }

    const snapshot = buildSnapshot(raw, accountId, symbol);

    if (!snapshot) {
      continue;
    }

    const accountMap = grouped.get(accountId) ?? new Map<string, NormalizedSnapshotEntry>();
    const key = makeKey(accountId, symbol);
    const entry: NormalizedSnapshotEntry = { accountId, symbol, snapshot };
    const existing = accountMap.get(key);

    if (!existing) {
      accountMap.set(key, entry);
    } else {
      accountMap.set(key, chooseSnapshot(existing, entry));
    }

    grouped.set(accountId, accountMap);
  }

  const result = new Map<AccountId, NormalizedSnapshotEntry[]>();

  for (const [accountId, map] of grouped.entries()) {
    result.set(accountId, Array.from(map.values()));
  }

  return result;
}

function groupUpdates(rows: BitMexPosition[]): Map<string, NormalizedUpdateEntry> {
  const grouped = new Map<string, NormalizedUpdateEntry>();

  for (const raw of rows) {
    const accountId = normalizeAccount(raw.account);
    const symbol = normalizeSymbol(raw.symbol);

    if (!accountId || !symbol) {
      continue;
    }

    const update = buildUpdate(raw);

    if (!update) {
      continue;
    }

    const key = makeKey(accountId, symbol);
    const entry: NormalizedUpdateEntry = { accountId, symbol, update };
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, entry);
    } else {
      grouped.set(key, chooseUpdate(existing, entry));
    }
  }

  return grouped;
}

function chooseSnapshot(prev: NormalizedSnapshotEntry, next: NormalizedSnapshotEntry): NormalizedSnapshotEntry {
  const prevTs = prev.snapshot.timestamp ?? undefined;
  const nextTs = next.snapshot.timestamp ?? undefined;

  if (nextTs && !prevTs) {
    return next;
  }

  if (!nextTs && prevTs) {
    return prev;
  }

  if (nextTs && prevTs) {
    return isNewerByTimestamp(prevTs, nextTs) ? next : prev;
  }

  return next;
}

function chooseUpdate(prev: NormalizedUpdateEntry, next: NormalizedUpdateEntry): NormalizedUpdateEntry {
  const prevTs = prev.update.timestamp ?? undefined;
  const nextTs = next.update.timestamp ?? undefined;

  if (nextTs && !prevTs) {
    return next;
  }

  if (!nextTs && prevTs) {
    return prev;
  }

  if (nextTs && prevTs) {
    return isNewerByTimestamp(prevTs, nextTs) ? next : prev;
  }

  return next;
}

function buildSnapshot(raw: BitMexPosition, accountId: AccountId, symbol: TradingSymbol): PositionSnapshot | null {
  const quantity = normalizeQuantity(raw.currentQty) ?? 0;
  const snapshot: PositionSnapshot = {
    accountId,
    symbol,
    currentQty: quantity,
    size: Math.max(0, Math.abs(quantity)),
    side: quantity < 0 ? 'sell' : 'buy',
  };

  const timestamp = normalizeTimestamp(raw.timestamp);
  if (timestamp !== undefined) {
    snapshot.timestamp = timestamp;
  }

  for (const field of NUMBER_FIELDS) {
    const value = normalizeNumeric(raw[field]);
    if (value !== undefined) {
      (snapshot as any)[field] = value;
    }
  }

  for (const field of STRING_FIELDS) {
    const value = normalizeString(raw[field]);
    if (value !== undefined) {
      (snapshot as any)[field] = value;
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = normalizeBoolean(raw[field]);
    if (value !== undefined) {
      (snapshot as any)[field] = value;
    }
  }

  snapshot.isOpen = snapshot.size > 0;

  return snapshot;
}

function buildUpdate(raw: BitMexPosition): PositionUpdate | null {
  const update: PositionUpdate = {};

  const timestamp = normalizeTimestamp(raw.timestamp);
  if (timestamp !== undefined) {
    update.timestamp = timestamp;
  }

  const quantity = normalizeQuantity(raw.currentQty);
  if (quantity !== undefined) {
    update.currentQty = quantity;
    update.size = Math.max(0, Math.abs(quantity));
    if (quantity !== 0) {
      update.side = quantity < 0 ? 'sell' : 'buy';
    }
  }

  for (const field of NUMBER_FIELDS) {
    const value = normalizeNumeric(raw[field]);
    if (value !== undefined) {
      (update as any)[field] = value;
    }
  }

  for (const field of STRING_FIELDS) {
    const value = normalizeString(raw[field]);
    if (value !== undefined) {
      (update as any)[field] = value;
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = normalizeBoolean(raw[field]);
    if (value !== undefined) {
      (update as any)[field] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    return null;
  }

  return update;
}

function normalizeAccount(value: unknown): AccountId | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return undefined;
}

function normalizeSymbol(value: unknown): TradingSymbol | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.toUpperCase();
}

function normalizeNumeric(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function normalizeBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return Boolean(value);
}

function normalizeString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeTimestamp(value: unknown): TimestampISO | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = normalizeWsTs(value as any);

  if (!normalized) {
    return undefined;
  }

  return normalized;
}

function normalizeQuantity(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function makeKey(accountId: AccountId, symbol: TradingSymbol): string {
  return `${accountId}::${symbol}`;
}

function createBaseSnapshot(accountId: AccountId, symbol: TradingSymbol): PositionSnapshot {
  return {
    accountId,
    symbol,
    currentQty: 0,
    size: 0,
    side: 'buy',
  };
}

const NUMBER_FIELDS = [
  'avgEntryPrice',
  'avgCostPrice',
  'bankruptPrice',
  'breakEvenPrice',
  'commission',
  'currentComm',
  'currentCost',
  'deleveragePercentile',
  'foreignNotional',
  'grossOpenCost',
  'grossOpenPremium',
  'homeNotional',
  'initMargin',
  'initMarginReq',
  'leverage',
  'liquidationPrice',
  'maintMargin',
  'maintMarginReq',
  'marginCallPrice',
  'markPrice',
  'markValue',
  'openOrderBuyCost',
  'openOrderBuyPremium',
  'openOrderBuyQty',
  'openOrderSellCost',
  'openOrderSellPremium',
  'openOrderSellQty',
  'openingQty',
  'posComm',
  'posCost',
  'posCost2',
  'posCross',
  'posLoss',
  'posMaint',
  'posMargin',
  'prevRealisedPnl',
  'prevUnrealisedPnl',
  'realisedCost',
  'realisedPnl',
  'rebalancedPnl',
  'riskLimit',
  'riskValue',
  'simpleCost',
  'simplePnl',
  'simplePnlPcnt',
  'simpleQty',
  'simpleValue',
  'unrealisedCost',
  'unrealisedPnl',
  'unrealisedPnlPcnt',
  'unrealisedRoePcnt',
] as const satisfies readonly (keyof PositionUpdate & keyof BitMexPosition)[];

const STRING_FIELDS = [
  'currency',
  'posState',
  'quoteCurrency',
  'underlying',
] as const satisfies readonly (keyof PositionUpdate & keyof BitMexPosition)[];

const BOOLEAN_FIELDS = ['crossMargin'] as const satisfies readonly (keyof PositionUpdate & keyof BitMexPosition)[];

