import { ValidationError } from '../../../../src/infra/errors.js';
import { validatePlaceInput } from '../../../../src/infra/validation.js';

describe('validatePlaceInput', () => {
  test('normalizes a valid limit order payload', () => {
    const result = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'buy',
      size: 10,
      price: 65_000,
      type: 'Limit',
      opts: {
        postOnly: true,
        timeInForce: '  GoodTillCancel ',
        reduceOnly: false,
        clOrdID: '  client-01  ',
      },
    });

    expect(result).toMatchObject({
      symbol: 'XBTUSD',
      side: 'buy',
      size: 10,
      type: 'Limit',
      price: 65_000,
      stopPrice: null,
      options: {
        postOnly: true,
        reduceOnly: false,
        timeInForce: 'GoodTillCancel',
        clOrdId: 'client-01',
      },
    });
  });

  test('normalizes a stop order and ignores postOnly flag', () => {
    const result = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'sell',
      size: 2,
      price: 63_500,
      type: 'Stop',
      opts: { reduceOnly: true },
    });

    expect(result.price).toBeNull();
    expect(result.stopPrice).toBe(63_500);
    expect(result.options.postOnly).toBe(false);
    expect(result.options.reduceOnly).toBe(true);
  });

  test('promotes stop order with stop-limit flag to StopLimit type', () => {
    const result = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'buy',
      size: 3,
      price: 30_100,
      type: 'Stop',
      opts: { stopLimitPrice: 30_150 },
      bestAsk: 30_000,
    });

    expect(result.type).toBe('StopLimit');
    expect(result.stopPrice).toBe(30_100);
    expect(result.price).toBe(30_150);
  });

  test('throws when buy stop price is below best ask', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'buy',
        size: 1,
        price: 29_900,
        type: 'Stop',
        bestAsk: 30_000,
      }),
    ).toThrow(ValidationError);
  });

  test('throws when market order carries price', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'buy',
        size: 1,
        price: 60_000,
        type: 'Market',
      }),
    ).toThrow(ValidationError);
  });

  test('throws when limit order is missing price', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'sell',
        size: 1,
        type: 'Limit',
      }),
    ).toThrow(ValidationError);
  });

  test('throws when postOnly is used for non-limit orders', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'sell',
        size: 1,
        price: 64_000,
        type: 'Stop',
        opts: { postOnly: true },
      }),
    ).toThrow(ValidationError);
  });

  test('throws when size is not positive', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'buy',
        size: 0,
        type: 'Market',
      }),
    ).toThrow(ValidationError);
  });
});
