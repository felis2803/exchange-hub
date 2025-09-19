import { OrderStatus } from '../../../domain/order.js';
import { ValidationError } from '../../../infra/errors.js';

import type { BitMexExecType, BitMexOrderStatus } from '../types.js';
import type { Side } from '../../../types.js';
import type { OrderType, PreparedPlaceInput } from '../../../infra/validation.js';
import type { CreateOrderPayload } from '../rest/orders.js';

const SIDE_TO_BITMEX: Record<Side, 'Buy' | 'Sell'> = {
  buy: 'Buy',
  sell: 'Sell',
};

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

export function inferOrderType(
  side: Side,
  price?: number | null,
  bestBid?: number | null,
  bestAsk?: number | null,
): OrderType {
  const normalizedPrice = normalizeFinite(price);

  if (normalizedPrice === null) {
    return 'Market';
  }

  const normalizedBid = normalizeFinite(bestBid);
  const normalizedAsk = normalizeFinite(bestAsk);

  if (side === 'buy') {
    if (normalizedAsk !== null && normalizedPrice > normalizedAsk) {
      return 'Stop';
    }

    return 'Limit';
  }

  if (side === 'sell') {
    if (normalizedBid !== null && normalizedPrice < normalizedBid) {
      return 'Stop';
    }

    return 'Limit';
  }

  return 'Limit';
}

export function mapPreparedPlaceInputToCreateOrderPayload(
  input: PreparedPlaceInput,
): CreateOrderPayload {
  const side = SIDE_TO_BITMEX[input.side];
  if (!side) {
    throw new ValidationError('Unsupported order side', { details: { side: input.side } });
  }

  if (typeof input.symbol !== 'string' || input.symbol.trim().length === 0) {
    throw new ValidationError('Instrument symbol is required', { details: { symbol: input.symbol } });
  }

  if (typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size <= 0) {
    throw new ValidationError('Order size must be a positive number', {
      details: { size: input.size },
    });
  }

  const ordType = normalizeRestOrderType(input.type);

  const clOrdId = input.options.clOrdId;
  if (typeof clOrdId !== 'string' || clOrdId.trim().length === 0) {
    throw new ValidationError('clOrdID is required for order placement', {
      details: { clOrdId },
    });
  }

  const payload: CreateOrderPayload = {
    symbol: input.symbol,
    side,
    orderQty: input.size,
    ordType,
    clOrdID: clOrdId,
  };

  if (ordType === 'Limit') {
    if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0) {
      throw new ValidationError('Limit orders require a positive price', {
        details: { price: input.price },
      });
    }
    payload.price = input.price;
  } else if (input.price !== null && input.price !== undefined) {
    throw new ValidationError('Market orders must not include price', {
      details: { price: input.price },
    });
  }

  if (typeof input.stopPrice === 'number' && Number.isFinite(input.stopPrice) && input.stopPrice > 0) {
    payload.stopPx = input.stopPrice;
  }

  if (input.options.timeInForce) {
    payload.timeInForce = input.options.timeInForce;
  }

  const execInstructions: string[] = [];
  if (input.options.postOnly) {
    execInstructions.push('ParticipateDoNotInitiate');
  }

  if (input.options.reduceOnly) {
    execInstructions.push('ReduceOnly');
  }

  if (execInstructions.length > 0) {
    payload.execInst = execInstructions.join(',');
  }

  return payload;
}

function normalizeFinite(value: number | null | undefined): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}

function normalizeRestOrderType(type: OrderType): 'Market' | 'Limit' {
  if (type === 'Market' || type === 'Limit') {
    return type;
  }

  throw new ValidationError('Order type is not supported for REST placement', {
    details: { type },
  });
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
