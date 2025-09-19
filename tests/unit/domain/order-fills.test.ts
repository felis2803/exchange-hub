import { Order, OrderStatus } from '../../../src/domain/order.js';

describe('Order fills', () => {
  test('computes VWAP across executions', () => {
    const order = new Order({
      orderId: 'ord-1',
      symbol: 'XBTUSD',
      status: OrderStatus.Placed,
      qty: 100,
    });

    order.applyUpdate(
      {
        execution: { execId: 'exec-1', qty: 20, price: 100, ts: 1 },
        cumQty: 20,
        avgPx: 100,
        leavesQty: 80,
        status: OrderStatus.PartiallyFilled,
      },
      { reason: 'fill' },
    );

    let snapshot = order.getSnapshot();
    expect(snapshot.filledQty).toBe(20);
    expect(snapshot.avgFillPrice).toBe(100);
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.executions[0]?.execId).toBe('exec-1');

    order.applyUpdate(
      {
        execution: { execId: 'exec-2', qty: 30, price: 110, ts: 2 },
        cumQty: 50,
        avgPx: 106,
        leavesQty: 50,
        status: OrderStatus.PartiallyFilled,
      },
      { reason: 'fill' },
    );

    snapshot = order.getSnapshot();
    expect(snapshot.filledQty).toBe(50);
    expect(snapshot.avgFillPrice).toBeCloseTo(106, 10);
    expect(snapshot.executions).toHaveLength(2);
  });

  test('ignores duplicate executions with the same execId', () => {
    const order = new Order({
      orderId: 'ord-dup',
      symbol: 'XBTUSD',
      status: OrderStatus.Placed,
      qty: 10,
    });

    order.applyUpdate(
      {
        execution: { execId: 'exec-dup', qty: 5, price: 200, ts: 1 },
        cumQty: 5,
        avgPx: 200,
        leavesQty: 5,
        status: OrderStatus.PartiallyFilled,
      },
      { reason: 'fill' },
    );

    const snapshot = order.getSnapshot();
    expect(snapshot.filledQty).toBe(5);
    expect(snapshot.executions).toHaveLength(1);

    order.applyUpdate(
      {
        execution: { execId: 'exec-dup', qty: 5, price: 210, ts: 2 },
        cumQty: 5,
        avgPx: 200,
        leavesQty: 5,
        status: OrderStatus.PartiallyFilled,
      },
      { reason: 'fill' },
    );

    const afterDuplicate = order.getSnapshot();
    expect(afterDuplicate.filledQty).toBe(5);
    expect(afterDuplicate.executions).toHaveLength(1);
    expect(afterDuplicate.avgFillPrice).toBe(200);
  });

  test('handles out-of-order executions deterministically', () => {
    const order = new Order({
      orderId: 'ord-out-of-order',
      symbol: 'XBTUSD',
      status: OrderStatus.Placed,
      qty: 40,
    });

    order.applyUpdate(
      {
        execution: { execId: 'exec-2', qty: 30, price: 120, ts: 2 },
        cumQty: 30,
        avgPx: 120,
        leavesQty: 10,
        status: OrderStatus.PartiallyFilled,
      },
      { reason: 'fill' },
    );

    order.applyUpdate(
      {
        execution: { execId: 'exec-1', qty: 10, price: 100, ts: 1 },
        cumQty: 40,
        avgPx: 115,
        leavesQty: 0,
        status: OrderStatus.Filled,
      },
      { reason: 'fill' },
    );

    const snapshot = order.getSnapshot();
    expect(snapshot.filledQty).toBe(40);
    expect(snapshot.avgFillPrice).toBeCloseTo(115, 10);
    expect(snapshot.executions).toHaveLength(2);
    expect(snapshot.executions[0]?.execId).toBe('exec-2');
    expect(snapshot.executions[1]?.execId).toBe('exec-1');
  });

  test('execution updates override local canceling state', () => {
    const order = new Order({
      orderId: 'ord-cancel',
      symbol: 'XBTUSD',
      status: OrderStatus.Placed,
      qty: 10,
    });

    order.markCanceling();
    expect(order.getSnapshot().status).toBe(OrderStatus.Canceling);

    order.applyUpdate(
      {
        execution: { execId: 'exec-final', qty: 10, price: 105, ts: 3 },
        cumQty: 10,
        avgPx: 105,
        leavesQty: 0,
      },
      { reason: 'fill' },
    );

    const snapshot = order.getSnapshot();
    expect(snapshot.status).toBe(OrderStatus.Filled);
    expect(snapshot.filledQty).toBe(10);
    expect(snapshot.avgFillPrice).toBe(105);
    expect(snapshot.executions).toHaveLength(1);
  });
});
