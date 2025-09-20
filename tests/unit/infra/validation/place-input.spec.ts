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
        stopLimitPrice: null,
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
    expect(result.options.stopLimitPrice).toBeNull();
  });

  test('normalizes a stop-limit order when flag is provided', () => {
    const result = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'buy',
      size: 3,
      price: 63_800,
      type: 'StopLimit',
      bestAsk: 63_700,
      opts: { stopLimitPrice: 63_750, reduceOnly: true },
    });

    expect(result.type).toBe('StopLimit');
    expect(result.price).toBe(63_750);
    expect(result.stopPrice).toBe(63_800);
    expect(result.options.stopLimitPrice).toBe(63_750);
    expect(result.options.reduceOnly).toBe(true);
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
    ).toThrowErrorMatchingInlineSnapshot('"market order cannot include price"');
  });

  test('throws when limit order is missing price', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'sell',
        size: 1,
        type: 'Limit',
      }),
    ).toThrowErrorMatchingInlineSnapshot('"limit order requires a finite positive price"');
  });

  test('throws when stop order omits price', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'sell',
        size: 1,
        type: 'Stop',
      }),
    ).toThrowErrorMatchingInlineSnapshot('"stop orders require a price"');
  });

  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -1],
  ])('throws when limit price is %s', (_, invalidPrice) => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'buy',
        size: 1,
        price: invalidPrice,
        type: 'Limit',
      }),
    ).toThrowErrorMatchingInlineSnapshot('"limit order requires a finite positive price"');
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
    ).toThrowErrorMatchingInlineSnapshot('"postOnly is allowed for limit orders only"');
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

  test('throws when stop price is on the wrong side of the book', () => {
    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'buy',
        size: 1,
        price: 63_400,
        type: 'Stop',
        bestAsk: 63_500,
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      '"buy stop price must be greater than or equal to best ask"',
    );

    expect(() =>
      validatePlaceInput({
        symbol: 'XBTUSD',
        side: 'sell',
        size: 1,
        price: 63_700,
        type: 'StopLimit',
        bestBid: 63_600,
        opts: { stopLimitPrice: 63_550 },
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      '"sell stop price must be less than or equal to best bid"',
    );
  });
});
