import { OrderBookL2 } from '../../src/domain/orderBookL2.js';

import type { L2Row } from '../../src/types/orderbook.js';

describe('OrderBookL2 (unit)', () => {
  test('reset builds price levels and aggregates best bid/ask', () => {
    const book = new OrderBookL2();
    const snapshot: L2Row[] = [
      { id: 1, side: 'buy', price: 100, size: 2 },
      { id: 2, side: 'buy', price: 101, size: 4 },
      { id: 3, side: 'buy', price: 101, size: 3 },
      { id: 4, side: 'sell', price: 103, size: 5 },
      { id: 5, side: 'sell', price: 102, size: 1 },
    ];

    book.reset(snapshot);

    expect(book.rows.size).toBe(5);
    expect(book.bestBid).toEqual({ price: 101, size: 7 });
    expect(book.bestAsk).toEqual({ price: 102, size: 1 });
    expect(book.outOfSync).toBe(false);
  });

  test('applyInsert adds rows and recomputes best quotes', () => {
    const book = new OrderBookL2();
    book.reset([
      { id: 1, side: 'buy', price: 100, size: 2 },
      { id: 2, side: 'sell', price: 105, size: 3 },
    ]);

    const delta = book.applyInsert([
      { id: 3, side: 'buy', price: 101, size: 1 },
      { id: 4, side: 'sell', price: 104, size: 2 },
      { id: 5, side: 'sell', price: 102, size: 4 },
    ]);

    expect(book.rows.size).toBe(5);
    expect(delta.changed).toEqual({ bids: 1, asks: 2 });
    expect(book.bestBid).toEqual({ price: 101, size: 1 });
    expect(book.bestAsk).toEqual({ price: 102, size: 4 });
    expect(book.outOfSync).toBe(false);
  });

  test('applyUpdate moves orders across price levels and updates best quotes', () => {
    const book = new OrderBookL2();
    book.reset([
      { id: 1, side: 'buy', price: 100, size: 3 },
      { id: 2, side: 'buy', price: 101, size: 1 },
      { id: 3, side: 'sell', price: 103, size: 2 },
      { id: 4, side: 'sell', price: 104, size: 5 },
    ]);

    const delta = book.applyUpdate([
      { id: 1, price: 102 },
      { id: 3, size: 1 },
    ]);

    expect(delta.changed).toEqual({ bids: 1, asks: 1 });
    expect(book.rows.get(1)).toEqual({ id: 1, side: 'buy', price: 102, size: 3 });
    expect(book.rows.get(3)).toEqual({ id: 3, side: 'sell', price: 103, size: 1 });
    expect(book.bestBid).toEqual({ price: 102, size: 3 });
    expect(book.bestAsk).toEqual({ price: 103, size: 1 });
    expect(book.outOfSync).toBe(false);
  });

  test('applyDelete removes rows and recomputes best quotes', () => {
    const book = new OrderBookL2();
    book.reset([
      { id: 1, side: 'buy', price: 100, size: 2 },
      { id: 2, side: 'buy', price: 101, size: 3 },
      { id: 3, side: 'sell', price: 105, size: 3 },
      { id: 4, side: 'sell', price: 102, size: 1 },
    ]);

    const delta = book.applyDelete([2, 4]);

    expect(delta.changed).toEqual({ bids: 1, asks: 1 });
    expect(book.rows.has(2)).toBe(false);
    expect(book.rows.has(4)).toBe(false);
    expect(book.bestBid).toEqual({ price: 100, size: 2 });
    expect(book.bestAsk).toEqual({ price: 105, size: 3 });
    expect(book.outOfSync).toBe(false);
  });

  test('marks outOfSync on inconsistent operations and reset clears the flag', () => {
    const book = new OrderBookL2();
    book.reset([{ id: 10, side: 'buy', price: 99, size: 2 }]);

    expect(book.outOfSync).toBe(false);

    const insertDelta = book.applyInsert([{ id: 10, side: 'buy', price: 100, size: 1 }]);
    expect(insertDelta.changed).toEqual({ bids: 0, asks: 0 });
    expect(book.outOfSync).toBe(true);

    const updateDelta = book.applyUpdate([{ id: 999, size: 5 }]);
    expect(updateDelta.changed).toEqual({ bids: 0, asks: 0 });
    expect(book.outOfSync).toBe(true);

    book.reset([{ id: 11, side: 'sell', price: 105, size: 4 }]);
    expect(book.outOfSync).toBe(false);
    expect(book.bestAsk).toEqual({ price: 105, size: 4 });
  });
});
