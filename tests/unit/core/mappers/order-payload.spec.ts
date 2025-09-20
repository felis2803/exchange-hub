import { mapPreparedOrderToCreatePayload } from '../../../../src/core/bitmex/mappers/order.js';
import { ValidationError } from '../../../../src/infra/errors.js';

import type { PreparedPlaceInput } from '../../../../src/infra/validation.js';

function makeInput(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 1,
    type: 'Limit',
    price: 50_000,
    stopPrice: null,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: null,
      stopLimitPrice: null,
      clOrdId: 'client-order-1',
    },
  };

  return {
    ...base,
    ...overrides,
    options: {
      ...base.options,
      ...(overrides.options ?? {}),
      clOrdId: overrides.options?.clOrdId ?? base.options.clOrdId,
    },
  };
}

describe('mapPreparedOrderToCreatePayload', () => {
  test('maps stop order to stop payload without price', () => {
    const input = makeInput({
      type: 'Stop',
      price: null,
      stopPrice: 50_050,
    });

    const payload = mapPreparedOrderToCreatePayload(input);

    expect(payload).toEqual({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 1,
      ordType: 'Stop',
      clOrdID: 'client-order-1',
      stopPx: 50_050,
    });
    expect(payload).not.toHaveProperty('price');
  });

  test('maps stop-limit order with both stop and limit prices', () => {
    const input = makeInput({
      type: 'StopLimit',
      price: 49_990,
      stopPrice: 50_000,
      options: { stopLimitPrice: 49_990 },
    });

    const payload = mapPreparedOrderToCreatePayload(input);

    expect(payload).toEqual({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 1,
      ordType: 'StopLimit',
      clOrdID: 'client-order-1',
      price: 49_990,
      stopPx: 50_000,
    });
  });

  test('includes exec instructions and time in force when provided', () => {
    const input = makeInput({
      options: {
        postOnly: true,
        reduceOnly: true,
        timeInForce: 'GoodTillCancel',
      },
    });

    const payload = mapPreparedOrderToCreatePayload(input);

    expect(payload.execInst).toBe('ParticipateDoNotInitiate,ReduceOnly');
    expect(payload.timeInForce).toBe('GoodTillCancel');
  });

  test('throws when limit price is missing for stop-limit orders', () => {
    const input = makeInput({
      type: 'StopLimit',
      price: null,
      stopPrice: 50_000,
      options: { stopLimitPrice: null },
    });

    expect(() => mapPreparedOrderToCreatePayload(input)).toThrow(ValidationError);
  });

  test('throws when stop price is missing for stop orders', () => {
    const input = makeInput({
      type: 'Stop',
      price: null,
      stopPrice: null,
    });

    expect(() => mapPreparedOrderToCreatePayload(input)).toThrow(ValidationError);
  });
});
