import { createLogger, LOG_TAGS } from '../../../infra/logger.js';
import { incrementCounter, observeHistogram } from '../../../infra/metrics.js';
import { METRICS } from '../../../infra/metrics-private.js';
import { normalizeWsTs as normalizeTimestamp, parseIsoTs } from '../../../infra/time.js';
import { mapBitmexOrderStatus } from '../mappers/order.js';
import { OrderStatus, type OrderSnapshot, type OrderUpdate, type OrderUpdateReason } from '../../../domain/order.js';
import type { PrivateLabels } from '../../../infra/metrics-private.js';
import type { DomainUpdate } from '../../types.js';
import type { BitMex } from '../index.js';
import type { BitMexChannelMessage, BitMexOrder } from '../types.js';

const log = createLogger('bitmex:order').withTags([LOG_TAGS.ws, LOG_TAGS.private, LOG_TAGS.order]);

type OrderChannelState = {
    awaitingSnapshot: boolean;
};

const channelState = new WeakMap<BitMex, OrderChannelState>();

function getChannelState(core: BitMex): OrderChannelState {
    let state = channelState.get(core);

    if (!state) {
        state = { awaitingSnapshot: true };
        channelState.set(core, state);
    }

    return state;
}

export function markOrderChannelAwaitingSnapshot(core: BitMex): void {
    getChannelState(core).awaitingSnapshot = true;
}

export function handleOrderMessage(core: BitMex, message: BitMexChannelMessage<'order'>): void {
    const state = getChannelState(core);
    const { action, data } = message;

    if (action === 'partial' && (!Array.isArray(data) || data.length === 0)) {
        state.awaitingSnapshot = false;

        return;
    }

    if (!Array.isArray(data) || data.length === 0) {
        return;
    }

    switch (action) {
        case 'partial':
            processBatch(core, data, 'snapshot');
            state.awaitingSnapshot = false;
            break;
        case 'insert':
            if (state.awaitingSnapshot) {
                log.debug('BitMEX order insert ignored until snapshot', { action });
                break;
            }

            processBatch(core, data, 'insert');
            break;
        case 'update':
            if (state.awaitingSnapshot) {
                log.debug('BitMEX order update ignored until snapshot', { action });
                break;
            }

            processBatch(core, data, 'update');
            break;
        default:
            log.debug('BitMEX order action ignored: %s', action, { action });
            break;
    }
}

function processBatch(core: BitMex, rows: BitMexOrder[], reason: UpdateReason): void {
    for (const row of rows) {
        processRow(core, row, reason);
    }
}

function processRow(core: BitMex, row: BitMexOrder, reason: UpdateReason): void {
    if (!row) {
        return;
    }

    const orderId = normalizeId(row.orderID);
    const clOrdId = normalizeId(row.clOrdID);

    if (!orderId && !clOrdId) {
        log.debug('BitMEX order skipped: no identifiers', { row });

        return;
    }

    const store = core.shell.orders;

    let order = orderId ? store.getByOrderId(orderId) : undefined;

    if (!order && clOrdId) {
        order = store.getByClOrdId(clOrdId);
    }

    const symbol = normalizeSymbol(row.symbol);

    const leavesQtyValue = isFiniteNumber(row.leavesQty) ? row.leavesQty : undefined;
    const cumQtyValue = isFiniteNumber(row.cumQty) ? row.cumQty : undefined;

    if (!order && orderId) {
        const initStatus =
            mapBitmexOrderStatus({
                ordStatus: row.ordStatus,
                execType: row.execType,
                leavesQty: leavesQtyValue ?? null,
                cumQty: cumQtyValue ?? null,
                previousStatus: null,
            }) ?? OrderStatus.Placed;

        order = store.create(orderId, {
            clOrdId,
            symbol: symbol ?? undefined,
            status: initStatus,
            side: normalizeSide(row.side),
            qty: isFiniteNumber(row.orderQty) ? row.orderQty : undefined,
            price: isFiniteNumber(row.price) ? row.price : undefined,
            leavesQty: leavesQtyValue,
            filledQty: cumQtyValue,
            avgFillPrice: isFiniteNumber(row.avgPx) ? row.avgPx : undefined,
        });
    }

    if (!order) {
        log.debug('BitMEX order update without known order', { orderId, clOrdId });

        return;
    }

    const previousStatus = order.status;
    const update: OrderUpdate = {};

    if (clOrdId) {
        update.clOrdId = clOrdId;
    }

    if (symbol) {
        update.symbol = symbol;
    }

    const side = normalizeSide(row.side);

    if (side) {
        update.side = side;
    }

    const ordType = normalizeString(row.ordType);

    if (ordType) {
        update.type = ordType;
    }

    const timeInForce = normalizeString(row.timeInForce);

    if (timeInForce) {
        update.timeInForce = timeInForce;
    }

    const execInst = normalizeString(row.execInst);

    if (execInst) {
        update.execInst = execInst;
    }

    if (isFiniteNumber(row.price)) {
        update.price = row.price;
    }

    if (isFiniteNumber(row.stopPx)) {
        update.stopPrice = row.stopPx;
    }

    if (isFiniteNumber(row.orderQty)) {
        update.qty = row.orderQty;
    }

    if (leavesQtyValue !== undefined) {
        update.leavesQty = leavesQtyValue;
    }

    if (cumQtyValue !== undefined) {
        update.cumQty = cumQtyValue;
    }

    if (isFiniteNumber(row.avgPx)) {
        update.avgPx = row.avgPx;
    }

    const status = mapBitmexOrderStatus({
        ordStatus: row.ordStatus,
        execType: row.execType,
        leavesQty: leavesQtyValue ?? null,
        cumQty: cumQtyValue ?? null,
        previousStatus,
    });

    if (status) {
        update.status = status;
    } else if (reason === 'insert' || reason === 'snapshot') {
        update.status = OrderStatus.Placed;
    }

    const liquidity = mapLiquidity(row.lastLiquidityInd);
    const execId = normalizeId(row.execID);
    const lastQty = isFiniteNumber(row.lastQty) ? row.lastQty : undefined;
    const lastPx = isFiniteNumber(row.lastPx) ? row.lastPx : undefined;
    const execTs = normalizeTimestampMs(row.transactTime ?? row.timestamp);

    if (execId || lastQty !== undefined) {
        update.execution = {
            execId: execId ?? undefined,
            qty: lastQty,
            price: lastPx,
            ts: execTs ?? undefined,
            liquidity,
        };
    }

    const lastUpdateTs = normalizeTimestampMs(row.transactTime ?? row.timestamp);

    if (lastUpdateTs !== null) {
        update.lastUpdateTs = lastUpdateTs;
    }

    const text = normalizeString(row.text);

    if (text) {
        update.text = text;
    }

    const updateReason = resolveReason(reason, row.execType, row.ordStatus, status ?? update.status);

    const diff = order.applyUpdate(update, { reason: updateReason });

    if (diff) {
        recordOrderMetrics(core, diff, row);
    }
}

type UpdateReason = 'snapshot' | 'insert' | 'update';

function resolveReason(
    base: UpdateReason,
    execType: BitMexOrder['execType'],
    ordStatus: BitMexOrder['ordStatus'],
    status: OrderStatus | undefined,
): OrderUpdateReason | undefined {
    if (execType === 'Trade') {
        return 'fill';
    }

    if (execType === 'Canceled') {
        return 'canceled';
    }

    if (execType === 'Expired') {
        return 'expired';
    }

    if (status === OrderStatus.Rejected) {
        return 'rejected';
    }

    if (ordStatus === 'Triggered') {
        return 'triggered';
    }

    if (execType === 'New' && base === 'update') {
        return 'replace';
    }

    return undefined;
}

function normalizeId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSymbol(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSide(value: unknown): 'buy' | 'sell' | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'buy' || normalized === 'sell') {
        return normalized as 'buy' | 'sell';
    }

    return null;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeTimestampMs(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const normalized = normalizeTimestamp(value);

    if (!normalized) {
        return null;
    }

    const parsed = parseIsoTs(normalized);

    return Number.isFinite(parsed) ? parsed : null;
}

function mapLiquidity(value: BitMexOrder['lastLiquidityInd']): 'maker' | 'taker' | undefined {
    switch (value) {
        case 'AddedLiquidity':
            return 'maker';
        case 'RemovedLiquidity':
            return 'taker';
        default:
            return undefined;
    }
}

function recordOrderMetrics(core: BitMex, diff: DomainUpdate<OrderSnapshot>, row: BitMexOrder): void {
    const env: PrivateLabels['env'] = core.isTest ? 'testnet' : 'mainnet';
    const labels: PrivateLabels = {
        env,
        table: 'order',
        symbol: diff.next.symbol ?? undefined,
    };

    incrementCounter(METRICS.orderUpdateCount, 1, labels);

    const normalizedTimestamp = normalizeTimestamp(row.transactTime ?? row.timestamp);

    if (!normalizedTimestamp) {
        return;
    }

    const timestampMs = parseIsoTs(normalizedTimestamp);

    if (!Number.isFinite(timestampMs)) {
        return;
    }

    const latency = Date.now() - timestampMs;

    if (!Number.isFinite(latency)) {
        return;
    }

    observeHistogram(METRICS.privateLatencyMs, Math.max(0, latency), labels);
}
