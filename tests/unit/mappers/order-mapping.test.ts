import { mapBitmexOrderStatus } from '../../../src/core/bitmex/mappers/order.js';
import { OrderStatus } from '../../../src/domain/order.js';

describe('BitMEX order status mapping', () => {
  test.each([
    { ordStatus: 'New', execType: undefined, expected: OrderStatus.Placed },
    { ordStatus: 'PartiallyFilled', execType: undefined, expected: OrderStatus.PartiallyFilled },
    { ordStatus: 'Filled', execType: undefined, expected: OrderStatus.Filled },
    { ordStatus: 'Canceled', execType: undefined, expected: OrderStatus.Canceled },
    { ordStatus: 'Rejected', execType: undefined, expected: OrderStatus.Rejected },
    { ordStatus: 'Expired', execType: undefined, expected: OrderStatus.Expired },
    { ordStatus: 'Triggered', execType: undefined, expected: OrderStatus.Placed },
    { ordStatus: 'Filled', execType: 'Trade', expected: OrderStatus.Filled },
    { ordStatus: 'PartiallyFilled', execType: 'Trade', expected: OrderStatus.PartiallyFilled },
    { ordStatus: 'Canceled', execType: 'Trade', expected: OrderStatus.Canceled },
    { ordStatus: undefined, execType: 'Trade', expected: OrderStatus.PartiallyFilled },
    { ordStatus: undefined, execType: 'Canceled', expected: OrderStatus.Canceled },
    { ordStatus: undefined, execType: 'Expired', expected: OrderStatus.Expired },
    { ordStatus: undefined, execType: 'New', expected: OrderStatus.Placed },
  ])('maps ordStatus=%s execType=%s to %s', ({ ordStatus, execType, expected }) => {
    expect(mapBitmexOrderStatus(ordStatus as any, execType as any)).toBe(expected);
  });

  test('returns undefined when both ordStatus and execType are missing', () => {
    expect(mapBitmexOrderStatus(undefined, undefined)).toBeUndefined();
  });
});
