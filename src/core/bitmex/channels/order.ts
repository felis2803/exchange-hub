import { createLogger, LOG_TAGS } from '../../../infra/logger.js';
import { mapBitmexOrderStatus } from '../mappers/order.js';

import { OrderStatus, type OrderUpdate } from '../../../domain/order.js';

import type { BitMex } from '../index.js';
import type { BitMexChannelMessage, BitMexOrder } from '../types.js';

const log = createLogger('bitmex:order').withTags([
  LOG_TAGS.ws,
  LOG_TAGS.private,
  LOG_TAGS.order,
]);

export function handleOrderMessage(core: BitMex, message: BitMexChannelMessage<'order'>): void {
  const { action, data } = message;

  if (!Array.isArray(data) || data.length === 0) {
    return;
  }

  switch (action) {
    case 'partial':
      processBatch(core, data, 'snapshot');
      break;
    case 'insert':
      processBatch(core, data, 'insert');
      break;
    case 'update':
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

  if (!order && orderId) {
    const initStatus = mapBitmexOrderStatus(row.ordStatus, row.execType) ?? OrderStatus.Placed;
    order = store.create(orderId, {
      clOrdId,
      symbol: symbol ?? undefined,
      status: initStatus,
      side: normalizeSide(row.side),
      qty: isFiniteNumber(row.orderQty) ? row.orderQty : undefined,
      price: isFiniteNumber(row.price) ? row.price : undefined,
      leavesQty: isFiniteNumber(row.leavesQty) ? row.leavesQty : undefined,
      filledQty: isFiniteNumber(row.cumQty) ? row.cumQty : undefined,
      avgFillPrice: isFiniteNumber(row.avgPx) ? row.avgPx : undefined,
    });
  }

  if (!order) {
    log.debug('BitMEX order update without known order', { orderId, clOrdId });
    return;
  }

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

  if (isFiniteNumber(row.leavesQty)) {
    update.leavesQty = row.leavesQty;
  }

  if (isFiniteNumber(row.cumQty)) {
    update.cumQty = row.cumQty;
  }

  if (isFiniteNumber(row.avgPx)) {
    update.avgPx = row.avgPx;
  }

  const status = mapBitmexOrderStatus(row.ordStatus, row.execType);
  if (status) {
    update.status = status;
  } else if (reason === 'insert' || reason === 'snapshot') {
    update.status = OrderStatus.Placed;
  }

  const liquidity = mapLiquidity(row.lastLiquidityInd);
  const execId = normalizeId(row.execID);
  const lastQty = isFiniteNumber(row.lastQty) ? row.lastQty : undefined;
  const lastPx = isFiniteNumber(row.lastPx) ? row.lastPx : undefined;
  const execTs = normalizeTimestamp(row.transactTime ?? row.timestamp);

  if (execId || lastQty !== undefined) {
    update.execution = {
      execId: execId ?? undefined,
      qty: lastQty,
      price: lastPx,
      ts: execTs ?? undefined,
      liquidity,
    };
  }

  const lastUpdateTs = normalizeTimestamp(row.transactTime ?? row.timestamp);
  if (lastUpdateTs !== null) {
    update.lastUpdateTs = lastUpdateTs;
  }

  const text = normalizeString(row.text);
  if (text) {
    update.text = text;
  }

  const updateReason = resolveReason(reason, row.execType, status ?? update.status);

  order.applyUpdate(update, { reason: updateReason });
}

type UpdateReason = 'snapshot' | 'insert' | 'update';

function resolveReason(
  base: UpdateReason,
  execType: BitMexOrder['execType'],
  status: OrderStatus | undefined,
): string {
  if (execType === 'Trade') {
    return 'fill';
  }

  if (execType === 'Canceled') {
    return 'cancel';
  }

  if (execType === 'Expired') {
    return 'expire';
  }

  if (status === OrderStatus.Rejected) {
    return 'rejected';
  }

  return base;
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

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }

  return null;
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
