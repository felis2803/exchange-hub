import { OrderStatus } from '../../../domain/order.js';
import { ValidationError } from '../../../infra/errors.js';

import type { CreateOrderParams } from '../../exchange-hub.js';
import type { CreateOrderPayload } from '../rest/orders.js';

import type { BitMexExecType, BitMexOrderStatus } from '../types.js';

export type BitmexOrderStatusInput = {
  ordStatus?: BitMexOrderStatus | null;
  execType?: BitMexExecType | null;
  leavesQty?: number | null;
  cumQty?: number | null;
  previousStatus?: OrderStatus | null;
};

const SIDE_MAP = {
  buy: 'Buy',
  sell: 'Sell',
} as const;

const ORDER_TYPE_MAP = {
  market: 'Market',
  limit: 'Limit',
} as const;

const TIME_IN_FORCE_MAP = {
  GTC: 'GoodTillCancel',
  IOC: 'ImmediateOrCancel',
  FOK: 'FillOrKill',
  DAY: 'Day',
} as const;

export function mapToBitmexCreateOrderPayload(params: CreateOrderParams): CreateOrderPayload {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) {
    throw new ValidationError('BitMEX create order requires symbol', {
      details: { symbol: params.symbol },
    });
  }

  const side = SIDE_MAP[params.side];
  if (!side) {
    throw new ValidationError('Unsupported order side', { details: { side: params.side } });
  }

  const ordTypeKey = String(params.type ?? '').toLowerCase();
  const ordType = ORDER_TYPE_MAP[ordTypeKey as keyof typeof ORDER_TYPE_MAP];
  if (!ordType) {
    throw new ValidationError('Unsupported order type', { details: { type: params.type } });
  }

  const orderQty = ensurePositiveNumber(params.quantity, 'quantity');

  let price: number | undefined;
  if (ordType === 'Limit') {
    price = ensurePositiveNumber(params.price, 'price');
  } else if (params.price !== undefined) {
    throw new ValidationError('Price is only allowed for limit orders', {
      details: { type: params.type, price: params.price },
    });
  }

  if (params.postOnly && ordType !== 'Limit') {
    throw new ValidationError('Post-only flag is only valid for limit orders', {
      details: { type: params.type, postOnly: params.postOnly },
    });
  }

  const instructions: string[] = [];
  if (params.postOnly) {
    instructions.push('ParticipateDoNotInitiate');
  }
  if (params.reduceOnly) {
    instructions.push('ReduceOnly');
  }

  const stopPx = params.stopPrice === undefined ? undefined : ensurePositiveNumber(params.stopPrice, 'stopPrice');
  const timeInForce = mapTimeInForce(params.timeInForce);
  const clOrdID = normalizeClOrdId(params.clientOrderId);
  const execInst = instructions.length > 0 ? instructions.join(',') : undefined;

  const payload: CreateOrderPayload = {
    symbol,
    side,
    orderQty,
    ordType,
  };

  if (price !== undefined) {
    payload.price = price;
  }

  if (clOrdID) {
    payload.clOrdID = clOrdID;
  }

  if (stopPx !== undefined) {
    payload.stopPx = stopPx;
  }

  if (execInst) {
    payload.execInst = execInst;
  }

  if (timeInForce) {
    payload.timeInForce = timeInForce;
  }

  return payload;
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClOrdId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function ensurePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`Invalid ${field}`, { details: { [field]: value } });
  }

  if (value <= 0) {
    throw new ValidationError(`${field} must be greater than zero`, {
      details: { [field]: value },
    });
  }

  return value;
}

function mapTimeInForce(value: unknown): CreateOrderPayload['timeInForce'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  const mapped = TIME_IN_FORCE_MAP[normalized as keyof typeof TIME_IN_FORCE_MAP];
  if (!mapped) {
    throw new ValidationError('Unsupported timeInForce', {
      details: { timeInForce: value },
    });
  }

  return mapped;
}

const STATUS_PRIORITY: Record<OrderStatus, number> = {
  [OrderStatus.Filled]: 6,
  [OrderStatus.PartiallyFilled]: 5,
  [OrderStatus.Rejected]: 4,
  [OrderStatus.Expired]: 3,
  [OrderStatus.Canceled]: 3,
  [OrderStatus.Canceling]: 2,
  [OrderStatus.Placed]: 1,
};

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
