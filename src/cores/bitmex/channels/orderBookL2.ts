import { createLogger } from '../../../infra/logger.js';
import type { BitmexOrderBookL2Raw } from '../../../types/bitmex.js';
import type { L2Row } from '../../../types/orderbook.js';
import type { BitMex } from '../index.js';
import type { BitMexChannelMessage } from '../types.js';

const log = createLogger('bitmex:orderbook');

type OrderBookMessage = BitMexChannelMessage<'orderBookL2'>;
type L2UpdateRow = Pick<L2Row, 'id'> & Partial<Omit<L2Row, 'id'>>;
type NormalizedBatch = {
  rows: L2Row[];
  bids: number;
  asks: number;
};

export function handleOrderBookMessage(core: BitMex, message: OrderBookMessage): void {
  const { action, data } = message;

  switch (action) {
    case 'partial':
      handleL2Partial(core, data);
      break;
    case 'insert':
      handleL2Insert(core, data);
      break;
    case 'update':
      handleL2Update(core, data);
      break;
    case 'delete':
      handleL2Delete(core, data);
      break;
    default:
      break;
  }
}

export function handleL2Partial(core: BitMex, rows: BitmexOrderBookL2Raw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = core.resolveInstrument(symbol);

    if (!instrument) {
      log.debug('BitMEX orderBookL2 partial ignored: instrument not found for %s', symbol);
      continue;
    }

    const { rows: snapshot, bids, asks } = normalizeInsert(batch);
    const book = instrument.orderBook;

    book.reset(snapshot);

    book.emit('update', {
      changed: { bids, asks },
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
    });

    log.debug('BitMEX orderBookL2 partial processed for %s', symbol, {
      batchSize: batch.length,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
    });
  }
}

export function handleL2Insert(core: BitMex, rows: BitmexOrderBookL2Raw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = core.resolveInstrument(symbol);

    if (!instrument) {
      log.debug('BitMEX orderBookL2 insert ignored: instrument not found for %s', symbol);
      continue;
    }

    const { rows: normalized } = normalizeInsert(batch);

    if (normalized.length === 0) {
      continue;
    }

    const book = instrument.orderBook;
    const wasOutOfSync = book.outOfSync;
    const delta = book.applyInsert(normalized);

    book.emit('update', delta);

    log.debug('BitMEX orderBookL2 insert processed for %s', symbol, {
      batchSize: batch.length,
      changed: delta.changed,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      outOfSync: book.outOfSync,
    });

    if (!wasOutOfSync && book.outOfSync) {
      log.warn('BitMEX orderBookL2 insert out-of-sync for %s, requesting resubscribe', symbol);
      core.resubscribeOrderBook(symbol);
    }
  }
}

export function handleL2Update(core: BitMex, rows: BitmexOrderBookL2Raw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = core.resolveInstrument(symbol);

    if (!instrument) {
      log.debug('BitMEX orderBookL2 update ignored: instrument not found for %s', symbol);
      continue;
    }

    const updates = normalizeUpdate(batch);

    if (updates.length === 0) {
      continue;
    }

    const book = instrument.orderBook;
    const wasOutOfSync = book.outOfSync;
    const delta = book.applyUpdate(updates);

    book.emit('update', delta);

    log.debug('BitMEX orderBookL2 update processed for %s', symbol, {
      batchSize: batch.length,
      changed: delta.changed,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      outOfSync: book.outOfSync,
    });

    if (!wasOutOfSync && book.outOfSync) {
      log.warn('BitMEX orderBookL2 update out-of-sync for %s, requesting resubscribe', symbol);
      core.resubscribeOrderBook(symbol);
    }
  }
}

export function handleL2Delete(core: BitMex, rows: BitmexOrderBookL2Raw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = core.resolveInstrument(symbol);

    if (!instrument) {
      log.debug('BitMEX orderBookL2 delete ignored: instrument not found for %s', symbol);
      continue;
    }

    const ids = normalizeDelete(batch);

    if (ids.length === 0) {
      continue;
    }

    const book = instrument.orderBook;
    const wasOutOfSync = book.outOfSync;
    const delta = book.applyDelete(ids);

    book.emit('update', delta);

    log.debug('BitMEX orderBookL2 delete processed for %s', symbol, {
      batchSize: batch.length,
      changed: delta.changed,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      outOfSync: book.outOfSync,
    });

    if (!wasOutOfSync && book.outOfSync) {
      log.warn('BitMEX orderBookL2 delete out-of-sync for %s, requesting resubscribe', symbol);
      core.resubscribeOrderBook(symbol);
    }
  }
}

function groupBySymbol(rows: BitmexOrderBookL2Raw[]): Map<string, BitmexOrderBookL2Raw[]> {
  const grouped = new Map<string, BitmexOrderBookL2Raw[]>();

  for (const row of rows) {
    const symbol = typeof row?.symbol === 'string' ? row.symbol.trim() : '';

    if (!symbol) {
      continue;
    }

    if (!grouped.has(symbol)) {
      grouped.set(symbol, []);
    }

    grouped.get(symbol)!.push(row);
  }

  return grouped;
}

function normalizeInsert(rows: BitmexOrderBookL2Raw[]): NormalizedBatch {
  const normalized: L2Row[] = [];
  let bids = 0;
  let asks = 0;

  for (const row of rows) {
    if (!row || typeof row.id !== 'number') {
      continue;
    }

    const price = toNumber(row.price);
    const size = toNumber(row.size);

    if (price === null || size === null) {
      continue;
    }

    const side = normalizeSide(row.side);

    if (!side) {
      continue;
    }

    normalized.push({
      id: row.id,
      side,
      price,
      size,
    });

    if (side === 'buy') {
      bids += 1;
    } else {
      asks += 1;
    }
  }

  return { rows: normalized, bids, asks };
}

function normalizeUpdate(rows: BitmexOrderBookL2Raw[]): L2UpdateRow[] {
  const normalized: L2UpdateRow[] = [];

  for (const row of rows) {
    if (!row || typeof row.id !== 'number') {
      continue;
    }

    const update: L2UpdateRow = { id: row.id };
    let hasPayload = false;

    const side = normalizeSide(row.side);
    if (side) {
      update.side = side;
      hasPayload = true;
    }

    const price = toNumber(row.price);
    if (price !== null) {
      update.price = price;
      hasPayload = true;
    }

    const size = toNumber(row.size);
    if (size !== null) {
      update.size = size;
      hasPayload = true;
    }

    if (hasPayload) {
      normalized.push(update);
    }
  }

  return normalized;
}

function normalizeDelete(rows: BitmexOrderBookL2Raw[]): number[] {
  const ids: number[] = [];

  for (const row of rows) {
    if (typeof row?.id === 'number') {
      ids.push(row.id);
    }
  }

  return ids;
}

function normalizeSide(side: BitmexOrderBookL2Raw['side']): 'buy' | 'sell' | null {
  if (side === 'Buy') {
    return 'buy';
  }

  if (side === 'Sell') {
    return 'sell';
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const num = Number(value);

  return Number.isFinite(num) ? num : null;
}
