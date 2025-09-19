import { OrderStatus } from '../../../domain/order.js';

import type { BitMexExecType, BitMexOrderStatus } from '../types.js';

export function mapBitmexOrderStatus(
  ordStatus?: BitMexOrderStatus | null,
  execType?: BitMexExecType | null,
): OrderStatus | undefined {
  const statusFromOrd = mapOrdStatus(ordStatus);

  if (statusFromOrd && isTerminalStatus(statusFromOrd)) {
    return statusFromOrd;
  }

  if (execType === 'Trade') {
    if (statusFromOrd === OrderStatus.Filled) {
      return OrderStatus.Filled;
    }

    if (statusFromOrd === OrderStatus.Canceled) {
      return OrderStatus.Canceled;
    }

    if (statusFromOrd === OrderStatus.PartiallyFilled) {
      return OrderStatus.PartiallyFilled;
    }

    if (statusFromOrd === OrderStatus.Placed) {
      return OrderStatus.PartiallyFilled;
    }

    return OrderStatus.PartiallyFilled;
  }

  const statusFromExec = mapExecStatus(execType);

  if (statusFromExec) {
    if (statusFromExec === OrderStatus.Placed) {
      return statusFromOrd ?? OrderStatus.Placed;
    }

    if (statusFromExec === OrderStatus.PartiallyFilled) {
      return statusFromOrd ?? OrderStatus.PartiallyFilled;
    }

    return statusFromExec;
  }

  if (statusFromOrd) {
    return statusFromOrd;
  }

  return undefined;
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

function mapExecStatus(execType?: BitMexExecType | null): OrderStatus | undefined {
  switch (execType) {
    case 'New':
      return OrderStatus.Placed;
    case 'Trade':
      return OrderStatus.PartiallyFilled;
    case 'Canceled':
      return OrderStatus.Canceled;
    case 'Expired':
      return OrderStatus.Expired;
    case 'Calculated':
    case 'Restated':
    case 'Settlement':
    case 'Funding':
      return undefined;
    default:
      return undefined;
  }
}

function isTerminalStatus(status: OrderStatus): boolean {
  return (
    status === OrderStatus.Canceled ||
    status === OrderStatus.Rejected ||
    status === OrderStatus.Expired ||
    status === OrderStatus.Filled
  );
}
