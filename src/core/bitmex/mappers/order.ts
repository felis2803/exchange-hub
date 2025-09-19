import { OrderStatus } from '../../../domain/order.js';

import type { BitMexExecType, BitMexOrderStatus } from '../types.js';

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

  let next = pickHighestPriority(candidates);

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
      if (context.ordStatus === OrderStatus.PartiallyFilled || context.qtyStatus === OrderStatus.PartiallyFilled) {
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
