import { inferOrderType } from '../../../../src/core/bitmex/mappers/order.js';

describe('inferOrderType', () => {
  test('returns Market when price is omitted', () => {
    expect(inferOrderType('buy', undefined, 100, 105)).toBe('Market');
    expect(inferOrderType('sell', null, 100, 105)).toBe('Market');
  });

  test('classifies buy limit zone at or below best ask', () => {
    expect(inferOrderType('buy', 100, 95, 105)).toBe('Limit');
    expect(inferOrderType('buy', 104, 95, 105)).toBe('Limit');
  });

  test('classifies buy stop zone above best ask', () => {
    expect(inferOrderType('buy', 106, 95, 105)).toBe('Stop');
    expect(inferOrderType('buy', 120, undefined, 110)).toBe('Stop');
    expect(inferOrderType('buy', 105, 95, 105)).toBe('Stop');
  });

  test('classifies sell limit zone at or above best bid', () => {
    expect(inferOrderType('sell', 105, 100, 110)).toBe('Limit');
    expect(inferOrderType('sell', 101, 100, 110)).toBe('Limit');
  });

  test('classifies sell stop zone below best bid', () => {
    expect(inferOrderType('sell', 98, 100, 110)).toBe('Stop');
    expect(inferOrderType('sell', 50, 60, undefined)).toBe('Stop');
    expect(inferOrderType('sell', 100, 100, 110)).toBe('Stop');
  });

  test('defaults to limit when no book context is available', () => {
    expect(inferOrderType('buy', 10, undefined, undefined)).toBe('Limit');
    expect(inferOrderType('sell', 10, undefined, undefined)).toBe('Limit');
  });
});
