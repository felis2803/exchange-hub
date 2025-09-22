import { Position } from '../../../domain/position.js';
import type { PositionSnapshot, PositionUpdate, PositionUpdateReason } from '../../../domain/position.js';
import { createLogger, LOG_TAGS } from '../../../infra/logger.js';
import { observeHistogram } from '../../../infra/metrics.js';
import { METRICS } from '../../../infra/metrics-private.js';
import { isNewerByTimestamp, normalizeWsTs, parseIsoTs } from '../../../infra/time.js';
import type { AccountId, Symbol as TradingSymbol, TimestampISO } from '../../types.js';
import type { BitMex } from '../index.js';
import type { BitMexChannelMessage, BitMexPosition } from '../types.js';
import type { PrivateLabels } from '../../../infra/metrics-private.js';

const log = createLogger('bitmex:position').withTags([LOG_TAGS.ws, LOG_TAGS.private, LOG_TAGS.position]);

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

type PositionRowState = {
    lastTimestamp?: TimestampISO | null;
    lastSnapshotHash?: string;
    lastUpdateHash?: string;
};

type PositionChannelState = {
    rows: Map<string, PositionRowState>;
    awaitingPartial: boolean;
};

const channelStates = new WeakMap<BitMex, PositionChannelState>();

function getChannelState(core: BitMex): PositionChannelState {
    let state = channelStates.get(core);

    if (!state) {
        state = { rows: new Map(), awaitingPartial: true };
        channelStates.set(core, state);
    }

    return state;
}

export function markPositionsAwaitingResync(core: BitMex): void {
    const state = getChannelState(core);

    state.awaitingPartial = true;
    state.rows.clear();
}

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
    const state = getChannelState(core);
    const registry = core.shell.positionsRegistry;

    state.awaitingPartial = false;

    if (!Array.isArray(rows) || rows.length === 0) {
        registry.clear();
        state.rows.clear();

        return;
    }

    const grouped = groupSnapshots(rows);

    for (const [accountId, entries] of grouped.entries()) {
        const seen = new Set<string>();

        for (const entry of entries) {
            const { symbol, snapshot } = entry;
            const key = makeKey(accountId, symbol);

            seen.add(key);

            let position = registry.get(accountId, symbol);

            if (!position) {
                position = new Position(createBaseSnapshot(accountId, symbol));
                registry.add(position);
            }

            const previousState = state.rows.get(key);
            const snapshotTimestamp = snapshot.timestamp ?? null;
            const snapshotHash = hashSnapshot(snapshot);
            let shouldReset = true;

            if (previousState?.lastTimestamp && snapshotTimestamp) {
                const isNewer = isNewerByTimestamp(previousState.lastTimestamp ?? undefined, snapshotTimestamp);

                if (!isNewer && snapshotTimestamp !== previousState.lastTimestamp) {
                    shouldReset = false;
                }
            }

            if (shouldReset && previousState) {
                if (
                    previousState.lastSnapshotHash === snapshotHash &&
                    snapshotTimestamp === previousState.lastTimestamp
                ) {
                    shouldReset = false;
                }
            }

            const symbolLog = log.withTags(['symbol']);

            if (shouldReset) {
                const changed = position.reset(snapshot, 'partial');

                if (changed) {
                    symbolLog.debug('BitMEX position partial applied for %s/%s', accountId, symbol, {
                        accountId,
                        symbol,
                    });
                    recordPositionLatency(core, symbol, snapshot.timestamp);
                }
            }

            const currentSnapshot = position.getSnapshot();

            if (currentSnapshot.size === 0) {
                registry.remove(position);
                state.rows.delete(key);
                symbolLog.debug('BitMEX position partial removed empty %s/%s', accountId, symbol, {
                    accountId,
                    symbol,
                });
                continue;
            }

            const nextState: PositionRowState = {
                lastTimestamp: currentSnapshot.timestamp ?? snapshotTimestamp ?? previousState?.lastTimestamp ?? null,
                lastSnapshotHash: hashSnapshot(currentSnapshot),
                lastUpdateHash: undefined,
            };

            state.rows.set(key, nextState);
        }

        const existingPositions = registry.byAccount(accountId);

        for (const position of existingPositions) {
            const key = makeKey(accountId, position.symbol);

            if (seen.has(key)) {
                continue;
            }

            position.update({ currentQty: 0, size: 0, side: 'buy' }, 'partial', {
                allowOlderTimestamp: true,
            });
            registry.remove(position);
            state.rows.delete(key);

            log.withTags(['symbol', LOG_TAGS.reconnect]).info(
                'BitMEX position partial removed stale %s/%s',
                accountId,
                position.symbol,
                {
                    accountId,
                    symbol: position.symbol,
                },
            );
        }

        const staleKeys: string[] = [];

        for (const key of state.rows.keys()) {
            if (!key.startsWith(`${accountId}::`) || seen.has(key)) {
                continue;
            }

            staleKeys.push(key);
        }

        for (const key of staleKeys) {
            state.rows.delete(key);
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

    const registry = core.shell.positionsRegistry;
    const state = getChannelState(core);

    for (const raw of rows) {
        const accountId = normalizeAccount(raw.account);
        const symbol = normalizeSymbol(raw.symbol);

        if (!accountId || !symbol) {
            continue;
        }

        const position = registry.get(accountId, symbol);

        if (!position) {
            continue;
        }

        const timestamp = normalizeTimestamp(raw.timestamp);
        const update: PositionUpdate = { currentQty: 0, size: 0, side: 'buy' };

        if (timestamp !== undefined) {
            update.timestamp = timestamp;
        }

        position.update(update, 'delete', { allowOlderTimestamp: true });
        registry.remove(position);
        state.rows.delete(makeKey(accountId, symbol));

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

    const state = getChannelState(core);

    if (state.awaitingPartial) {
        return;
    }

    const updates = groupUpdates(rows);
    const registry = core.shell.positionsRegistry;

    for (const entry of updates.values()) {
        const { accountId, symbol, update } = entry;
        const key = makeKey(accountId, symbol);
        const updateHash = hashUpdate(update);
        const timestamp = update.timestamp ?? null;
        let rowState = state.rows.get(key);

        if (!rowState && reason !== 'insert') {
            continue;
        }

        if (!rowState) {
            rowState = {
                lastTimestamp: timestamp ?? null,
                lastSnapshotHash: undefined,
                lastUpdateHash: undefined,
            };
        }

        if (rowState.lastTimestamp && timestamp) {
            const isNewer = isNewerByTimestamp(rowState.lastTimestamp ?? undefined, timestamp);

            if (!isNewer && timestamp !== rowState.lastTimestamp) {
                continue;
            }

            if (timestamp === rowState.lastTimestamp && rowState.lastUpdateHash === updateHash) {
                continue;
            }
        } else if (rowState.lastUpdateHash === updateHash) {
            continue;
        }

        let position = registry.get(accountId, symbol);

        if (!position) {
            position = new Position(createBaseSnapshot(accountId, symbol));
            registry.add(position);
        }

        const applied = position.update(update, reason, { allowOlderTimestamp: reason === 'insert' });

        if (!applied) {
            rowState.lastUpdateHash = updateHash;

            if (!rowState.lastTimestamp && timestamp) {
                rowState.lastTimestamp = timestamp;
            }

            state.rows.set(key, rowState);
            continue;
        }

        const snapshot = position.getSnapshot();
        const symbolLog = log.withTags(['symbol']);

        symbolLog.debug('BitMEX position %s applied for %s/%s', reason, accountId, symbol, {
            accountId,
            symbol,
            reason,
        });

        if (update.timestamp) {
            recordPositionLatency(core, symbol, update.timestamp);
        }

        if (snapshot.size === 0) {
            registry.remove(position);
            state.rows.delete(key);
            symbolLog.debug('BitMEX position %s removed empty %s/%s', reason, accountId, symbol, {
                accountId,
                symbol,
                reason,
            });
            continue;
        }

        rowState.lastTimestamp = snapshot.timestamp ?? timestamp ?? rowState.lastTimestamp ?? null;
        rowState.lastSnapshotHash = hashSnapshot(snapshot);
        rowState.lastUpdateHash = updateHash;
        state.rows.set(key, rowState);
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

function stableSerialize(record: Record<string, unknown>): string {
    const entries = Object.entries(record)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return JSON.stringify(entries);
}

function hashSnapshot(snapshot: PositionSnapshot): string {
    return stableSerialize(snapshot as Record<string, unknown>);
}

function hashUpdate(update: PositionUpdate): string {
    return stableSerialize(update as Record<string, unknown>);
}

function recordPositionLatency(core: BitMex, symbol: TradingSymbol, timestamp: TimestampISO | null | undefined): void {
    if (!timestamp) {
        return;
    }

    const parsed = parseIsoTs(timestamp);

    if (!Number.isFinite(parsed)) {
        return;
    }

    const latency = Date.now() - parsed;

    if (!Number.isFinite(latency)) {
        return;
    }

    const env: PrivateLabels['env'] = core.isTest ? 'testnet' : 'mainnet';
    const labels: PrivateLabels = { env, table: 'position', symbol };

    observeHistogram(METRICS.privateLatencyMs, Math.max(0, latency), labels);
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
