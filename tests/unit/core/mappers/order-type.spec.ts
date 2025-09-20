import { inferOrderType } from '../../../../src/core/bitmex/mappers/order.js';

describe('inferOrderType', () => {
  test('returns Market when price is omitted', () => {
    expect(inferOrderType('buy', undefined, 100, 105)).toBe('Market');
    expect(inferOrderType('sell', null, 100, 105)).toBe('Market');
  });

  test('classifies buy limit zone below best ask', () => {
    expect(inferOrderType('buy', 100, 95, 105)).toBe('Limit');
    expect(inferOrderType('buy', 104, 95, 105)).toBe('Limit');
  });

  test('treats equality with best ask or bid as stop', () => {
    expect(inferOrderType('buy', 105, 95, 105)).toBe('Stop');
    expect(inferOrderType('sell', 100, 100, 110)).toBe('Stop');
  });

  test('classifies buy stop zone at or above best ask', () => {
    expect(inferOrderType('buy', 106, 95, 105)).toBe('Stop');
    expect(inferOrderType('buy', 120, undefined, 110)).toBe('Stop');
  });

  test('classifies sell limit zone above best bid', () => {
    expect(inferOrderType('sell', 105, 100, 110)).toBe('Limit');
    expect(inferOrderType('sell', 101, 100, 110)).toBe('Limit');
  });

  test('classifies sell stop zone at or below best bid', () => {
    expect(inferOrderType('sell', 100, 100, 110)).toBe('Stop');
    expect(inferOrderType('sell', 98, 100, 110)).toBe('Stop');
    expect(inferOrderType('sell', 50, 60, undefined)).toBe('Stop');
  });

  test('defaults to limit when no book context is available', () => {
    expect(inferOrderType('buy', 10, undefined, undefined)).toBe('Limit');
    expect(inferOrderType('sell', 10, undefined, undefined)).toBe('Limit');
  });

  test('falls back to limit when only one side of the book is known', () => {
    expect(inferOrderType('buy', 10, 8, undefined)).toBe('Limit');
    expect(inferOrderType('sell', 12, undefined, 13)).toBe('Limit');
  });

  test('returns StopLimit when stopLimitPrice option is provided', () => {
    expect(inferOrderType('buy', 110, 100, 105, { stopLimitPrice: 111 })).toBe('StopLimit');
    expect(inferOrderType('sell', 90, 95, 100, { stopLimitPrice: 89 })).toBe('StopLimit');
  });

  test('prefers StopLimit option even without book context', () => {
    expect(inferOrderType('buy', 120, undefined, undefined, { stopLimitPrice: 121 })).toBe(
      'StopLimit',
    );
    expect(inferOrderType('sell', 80, undefined, undefined, { stopLimitPrice: 79 })).toBe(
      'StopLimit',
    );
  });
});
