import { mapPreparedOrderToCreatePayload } from '../../../../src/core/bitmex/mappers/order.js';
import { ValidationError } from '../../../../src/infra/errors.js';

import type { PreparedPlaceInput } from '../../../../src/infra/validation.js';

function createPreparedInput(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 10,
    type: 'Limit',
    price: 50_000,
    stopPrice: null,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: 'GoodTillCancel',
      clOrdId: 'cli-unit-1',
    },
  };

  return {
    ...base,
    ...overrides,
    options: { ...base.options, ...overrides.options },
  };
}

describe('mapPreparedOrderToCreatePayload', () => {
  test('throws ValidationError when market order is marked as post-only', () => {
    const input = createPreparedInput({
      type: 'Market',
      price: null,
      options: { postOnly: true },
    });

    expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
      new ValidationError('postOnly is allowed for limit orders only'),
    );
  });

  test.each([
    ['GoodTillCancel', 'GoodTillCancel'],
    ['ImmediateOrCancel', 'ImmediateOrCancel'],
    ['FillOrKill', 'FillOrKill'],
    ['GTC', 'GoodTillCancel'],
    ['IOC', 'ImmediateOrCancel'],
    ['FOK', 'FillOrKill'],
    ['gtc', 'GoodTillCancel'],
    ['ioc', 'ImmediateOrCancel'],
    ['fok', 'FillOrKill'],
    ['  GTC  ', 'GoodTillCancel'],
  ])('normalizes timeInForce %s to %s', (timeInForce, expected) => {
    const input = createPreparedInput({ options: { timeInForce } });

    const payload = mapPreparedOrderToCreatePayload(input);
    expect(payload.timeInForce).toBe(expected);
  });

  test('throws ValidationError on unsupported timeInForce', () => {
    const input = createPreparedInput({ options: { timeInForce: 'Day' } });

    expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
      new ValidationError('unsupported timeInForce'),
    );
  });
});
