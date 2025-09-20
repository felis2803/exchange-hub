import { OrderStatus } from '../../../domain/order.js';
import { ValidationError } from '../../../infra/errors.js';

import type { PlaceOpts, PreparedPlaceInput } from '../../../infra/validation.js';

import type { BitMexExecType, BitMexOrderStatus } from '../types.js';
import type { Side } from '../../../types.js';
import type { OrderType } from '../../../infra/validation.js';
import type { CreateOrderPayload } from '../rest/orders.js';

export type BitmexOrderStatusInput = {
  ordStatus?: BitMexOrderStatus | null;
  execType?: BitMexExecType | null;
  leavesQty?: number | null;
  cumQty?: number | null;
  previousStatus?: OrderStatus | null;
};

const STATUS_PRIORITY: Record<OrderStatus, number> = {
  [OrderStatus.Filled]: 6,
  [OrderStatus.PartiallyFilled]: 5,
  [OrderStatus.Rejected]: 4,
  [OrderStatus.Expired]: 3,
  [OrderStatus.Canceled]: 3,
  [OrderStatus.Canceling]: 2,
  [OrderStatus.Placed]: 1,
};

/**
 * Infers the BitMEX order type from the provided context.
 *
 * - When price is omitted we default to a market order – this mirrors the API
 *   contract where the caller specifies size/side only.
 * - Presence of the stopLimitPrice option explicitly maps the request to a
 *   stop-limit order. Validation is responsible for ensuring accompanying
 *   fields are present and consistent.
 * - When the top of book is unavailable (for example right after startup) we
 *   conservatively assume a limit order. This prevents us from accidentally
 *   tagging the order as a stop just because the order book did not stream yet.
 * - Prices that sit on or beyond the best bid/ask are considered stops so that
 *   we never submit an aggressive limit order when the intent is to trigger a
 *   stop.
 */
export function inferOrderType(
  side: Side,
  price?: number | null,
  bestBid?: number | null,
  bestAsk?: number | null,
  opts?: PlaceOpts | null,
): OrderType {
  const wantsStopLimit = opts?.stopLimitPrice !== undefined && opts?.stopLimitPrice !== null;

  if (wantsStopLimit) {
    return 'StopLimit';
  }

  const normalizedPrice = normalizeFinite(price);

  if (normalizedPrice === null) {
    return 'Market';
  }

  const normalizedBid = normalizeFinite(bestBid);
  const normalizedAsk = normalizeFinite(bestAsk);

  if (side === 'buy') {
    if (normalizedAsk !== null && normalizedPrice >= normalizedAsk) {
      return 'Stop';
    }

    // Missing ask or equality with the best ask fall back to a passive limit.
    return 'Limit';
  }

  if (side === 'sell') {
    if (normalizedBid !== null && normalizedPrice <= normalizedBid) {
      return 'Stop';
    }

    // Missing bid or equality with the best bid also map to a limit order.
    return 'Limit';
  }

  return 'Limit';
}

function normalizeFinite(value: number | null | undefined): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}

export function mapPreparedOrderToCreatePayload(input: PreparedPlaceInput): CreateOrderPayload {
  const side = input.side === 'sell' ? 'Sell' : 'Buy';
  const payload: CreateOrderPayload = {
    symbol: input.symbol,
    side,
    orderQty: input.size,
    ordType: input.type,
    clOrdID: input.options.clOrdId,
  };

  if (input.type === 'Limit' || input.type === 'StopLimit') {
    if (input.price === null) {
      const message =
        input.type === 'StopLimit'
          ? 'stop-limit order requires a limit price'
          : 'limit order requires price';

      throw new ValidationError(message, {
        details: { type: input.type },
      });
    }

    payload.price = input.price;
  }

  if (input.type === 'Stop' || input.type === 'StopLimit') {
    if (input.stopPrice === null || input.stopPrice === undefined) {
      throw new ValidationError('stop order requires stop price', {
        details: { type: input.type },
      });
    }

    payload.stopPx = input.stopPrice;
  }

  const execInst: string[] = [];
  if (input.options.postOnly && input.type === 'Limit') {
    execInst.push('ParticipateDoNotInitiate');
  }
  if (input.options.reduceOnly) {
    execInst.push('ReduceOnly');
  }

  if (execInst.length > 0) {
    payload.execInst = execInst.join(',');
  }

  if (input.options.timeInForce) {
    payload.timeInForce = input.options.timeInForce as CreateOrderPayload['timeInForce'];
  }

  return payload;
}

export function mapBitmexOrderStatus({
  ordStatus,
  execType,
  leavesQty,
  cumQty,
  previousStatus,
}: BitmexOrderStatusInput): OrderStatus | undefined {
  const normalizedLeaves = normalizeQuantity(leavesQty);
  const normalizedCum = normalizeQuantity(cumQty);

  const statusFromOrd = mapOrdStatus(ordStatus);
  const statusFromQty = mapStatusFromQuantities(normalizedCum, normalizedLeaves, statusFromOrd);
  const statusFromExec = mapExecStatus(execType, {
    ordStatus: statusFromOrd,
    qtyStatus: statusFromQty,
    cumQty: normalizedCum,
    leavesQty: normalizedLeaves,
  });

  const candidates = [statusFromExec, statusFromOrd, statusFromQty].filter(
    (status): status is OrderStatus => Boolean(status),
  );
  const next = pickHighestPriority(candidates);

  if (previousStatus && isTerminal(previousStatus)) {
    if (!next) {
      return previousStatus;
    }

    if (!isTerminal(next)) {
      return previousStatus;
    }

    if (STATUS_PRIORITY[next] < STATUS_PRIORITY[previousStatus]) {
      return previousStatus;
    }
  }

  if (!next) {
    return previousStatus ?? undefined;
  }

  return next;
}

function mapOrdStatus(status?: BitMexOrderStatus | null): OrderStatus | undefined {
  switch (status) {
    case 'New':
      return OrderStatus.Placed;
    case 'PartiallyFilled':
      return OrderStatus.PartiallyFilled;
    case 'Filled':
      return OrderStatus.Filled;
    case 'Canceled':
      return OrderStatus.Canceled;
    case 'Rejected':
      return OrderStatus.Rejected;
    case 'Expired':
      return OrderStatus.Expired;
    case 'Triggered':
      return OrderStatus.Placed;
    default:
      return undefined;
  }
}

function mapExecStatus(
  execType: BitMexExecType | undefined | null,
  context: {
    ordStatus?: OrderStatus;
    qtyStatus?: OrderStatus;
    cumQty: number | null;
    leavesQty: number | null;
  },
): OrderStatus | undefined {
  switch (execType) {
    case 'Trade':
      if (
        context.qtyStatus === OrderStatus.Filled ||
        context.ordStatus === OrderStatus.Filled ||
        isFilledByQuantities(context.cumQty, context.leavesQty)
      ) {
        return OrderStatus.Filled;
      }

      return OrderStatus.PartiallyFilled;
    case 'Canceled':
      if (context.ordStatus === OrderStatus.Filled || context.qtyStatus === OrderStatus.Filled) {
        return OrderStatus.Filled;
      }

      return OrderStatus.Canceled;
    case 'Expired':
      return OrderStatus.Expired;
    case 'New':
      if (
        context.ordStatus === OrderStatus.PartiallyFilled ||
        context.qtyStatus === OrderStatus.PartiallyFilled
      ) {
        return OrderStatus.PartiallyFilled;
      }

      return OrderStatus.Placed;
    case 'Restated':
    case 'Calculated':
      if (context.ordStatus === OrderStatus.Filled || context.qtyStatus === OrderStatus.Filled) {
        return OrderStatus.Filled;
      }

      if (
        context.ordStatus === OrderStatus.PartiallyFilled ||
        context.qtyStatus === OrderStatus.PartiallyFilled
      ) {
        return OrderStatus.PartiallyFilled;
      }

      return undefined;
    case 'Settlement':
      if (context.ordStatus === OrderStatus.Filled || context.qtyStatus === OrderStatus.Filled) {
        return OrderStatus.Filled;
      }

      return undefined;
    case 'Funding':
    default:
      return undefined;
  }
}

function mapStatusFromQuantities(
  cumQty: number | null,
  leavesQty: number | null,
  statusFromOrd?: OrderStatus,
): OrderStatus | undefined {
  if (isFilledByQuantities(cumQty, leavesQty)) {
    return OrderStatus.Filled;
  }

  if (cumQty !== null && cumQty > 0) {
    return OrderStatus.PartiallyFilled;
  }

  if (statusFromOrd === OrderStatus.PartiallyFilled && leavesQty !== null && leavesQty <= 0) {
    return OrderStatus.PartiallyFilled;
  }

  if (statusFromOrd === OrderStatus.Filled) {
    return OrderStatus.Filled;
  }

  return undefined;
}

function isFilledByQuantities(cumQty: number | null, leavesQty: number | null): boolean {
  return cumQty !== null && cumQty > 0 && (leavesQty !== null ? leavesQty <= 0 : false);
}

function normalizeQuantity(value: number | null | undefined): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return value <= 0 ? 0 : value;
}

function pickHighestPriority(statuses: OrderStatus[]): OrderStatus | undefined {
  let current: OrderStatus | undefined;

  for (const status of statuses) {
    if (!current || STATUS_PRIORITY[status] > STATUS_PRIORITY[current]) {
      current = status;
    }
  }

  return current;
}

function isTerminal(status: OrderStatus): boolean {
  return (
    status === OrderStatus.Filled ||
    status === OrderStatus.Rejected ||
    status === OrderStatus.Expired ||
    status === OrderStatus.Canceled
  );
}
