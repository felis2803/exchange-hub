import { mapBitmexOrderStatus } from '../mappers/order.js';
import { normalizeWsTs as normalizeTimestamp, parseIsoTs } from '../../../infra/time.js';

import type { PreparedPlaceInput } from '../../../infra/validation.js';
import type { OrdersRegistry } from '../../exchange-hub.js';
import type { Order, OrderUpdate } from '../../../domain/order.js';
import type { BitMexOrder, BitMexPlaceOrderRequest } from '../types.js';

export interface CreateOrderDependencies {
  orders: OrdersRegistry;
  submit: (payload: BitMexPlaceOrderRequest) => Promise<BitMexOrder>;
  now?: () => number;
}

export async function createOrder(
  deps: CreateOrderDependencies,
  input: PreparedPlaceInput,
): Promise<Order> {
  const { orders, submit, now } = deps;
  const clOrdId = input.options.clOrdId;
  const submittedAt = typeof now === 'function' ? now() : Date.now();
  const payload = buildCreatePayload(input);

  const restPromise = submit(payload)
    .then((row) => upsertOrderFromRest(orders, row, { submittedAt }))
    .finally(() => {
      orders.clearInflight(clOrdId);
    });

  orders.registerInflight(clOrdId, restPromise);

  return restPromise;
}

export function buildCreatePayload(input: PreparedPlaceInput): BitMexPlaceOrderRequest {
  const { symbol, side, size, type, price, stopPrice, options } = input;

  const payload: BitMexPlaceOrderRequest = {
    symbol,
    side: side === 'buy' ? 'Buy' : 'Sell',
    orderQty: size,
    ordType: type,
    clOrdID: options.clOrdId,
  };

  if ((type === 'Limit' || type === 'StopLimit') && price !== null) {
    payload.price = price;
  }

  if ((type === 'Stop' || type === 'StopLimit') && stopPrice !== null) {
    payload.stopPx = stopPrice;
  }

  if (options.timeInForce) {
    payload.timeInForce = options.timeInForce as BitMexPlaceOrderRequest['timeInForce'];
  }

  const execInst: string[] = [];
  if (options.postOnly) {
    execInst.push('ParticipateDoNotInitiate');
  }
  if (options.reduceOnly) {
    execInst.push('ReduceOnly');
  }

  if (execInst.length > 0) {
    payload.execInst = execInst.join(',') as BitMexPlaceOrderRequest['execInst'];
  }

  return payload;
}

interface UpsertContext {
  submittedAt: number;
}

function upsertOrderFromRest(
  orders: OrdersRegistry,
  row: BitMexOrder,
  context: UpsertContext,
): Order {
  const orderId = normalizeId(row.orderID);
  if (!orderId) {
    throw new Error('BitMEX order response is missing orderID');
  }

  let order = orders.getByOrderId(orderId);
  if (!order) {
    order = orders.create(orderId, { submittedAt: context.submittedAt });
  }

  const update: OrderUpdate = {};

  const clOrdId = normalizeId(row.clOrdID);
  if (clOrdId) {
    update.clOrdId = clOrdId;
  }

  const symbol = normalizeString(row.symbol);
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

  const leavesQty = normalizeQuantity(row.leavesQty);
  if (leavesQty !== null) {
    update.leavesQty = leavesQty;
  }

  const cumQty = normalizeQuantity(row.cumQty);
  if (cumQty !== null) {
    update.cumQty = cumQty;
  }

  if (isFiniteNumber(row.avgPx)) {
    update.avgPx = row.avgPx;
  }

  const text = normalizeString(row.text);
  if (text) {
    update.text = text;
  }

  const status = mapBitmexOrderStatus({
    ordStatus: row.ordStatus,
    execType: row.execType,
    leavesQty,
    cumQty,
    previousStatus: order.status,
  });
  if (status) {
    update.status = status;
  }

  const lastUpdateTs = normalizeTimestampMs(row.transactTime ?? row.timestamp);
  if (lastUpdateTs !== null) {
    update.lastUpdateTs = lastUpdateTs;
  }

  if (!order.getSnapshot().submittedAt && Number.isFinite(context.submittedAt)) {
    update.submittedAt = context.submittedAt;
  }

  order.applyUpdate(update);
  return order;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeString(value: unknown): string | null {
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
    return normalized;
  }

  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeQuantity(value: unknown): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return value;
}

function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return null;
  }

  const parsed = parseIsoTs(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
