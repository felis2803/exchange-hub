import { createLogger } from '../../../infra/logger.js';

import { TRADE_BUFFER_MAX, TRADE_BUFFER_MIN } from '../constants.js';

import type { Instrument } from '../../../domain/instrument.js';
import type { Trade, BitmexTradeRaw } from '../../../types/bitmex.js';
import type { BitMex } from '../index.js';
import type { BitMexChannelMessage } from '../types.js';

const log = createLogger('bitmex:trade');

export function handleTradeMessage(core: BitMex, message: BitMexChannelMessage<'trade'>): void {
  const { action, data } = message;

  switch (action) {
    case 'partial':
      handleTradePartial(core, data);
      break;
    case 'insert':
      handleTradeInsert(core, data);
      break;
    default:
      log.debug('BitMEX trade action ignored: %s', action, { action });
      break;
  }
}

export function handleTradePartial(core: BitMex, rows: BitmexTradeRaw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = resolveInstrument(core, symbol);

    if (!instrument) {
      log.debug('BitMEX trade partial: instrument not found for %s', symbol);
      continue;
    }

    const { trades, skipped } = normalizeBatch(batch);

    if (trades.length === 0) {
      log.debug('BitMEX trade partial: no valid trades for %s', symbol, { skipped });
      continue;
    }

    const capacity = clampBufferSize(instrument.tradeBufferSize);
    const start = trades.length > capacity ? trades.length - capacity : 0;
    const limited = start > 0 ? trades.slice(start) : trades;
    const trimmed = trades.length - limited.length;
    const result = instrument.trades.push(limited, { reset: true, silent: true });

    log.debug('BitMEX trade partial processed for %s', symbol, {
      batchSize: batch.length,
      normalized: trades.length,
      trimmed,
      skipped,
      added: result.added,
      dropped: result.dropped,
      bufferSize: instrument.trades.length,
    });
  }
}

export function handleTradeInsert(core: BitMex, rows: BitmexTradeRaw[]): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const [symbol, batch] of groupBySymbol(rows)) {
    const instrument = resolveInstrument(core, symbol);

    if (!instrument) {
      log.debug('BitMEX trade insert: instrument not found for %s', symbol);
      continue;
    }

    const { trades, skipped } = normalizeBatch(batch);

    if (trades.length === 0) {
      if (skipped > 0) {
        log.debug('BitMEX trade insert: skipped invalid trades for %s', symbol, { skipped });
      }
      continue;
    }

    const result = instrument.trades.push(trades);
    const deduplicated = trades.length - result.added;

    log.debug('BitMEX trade insert processed for %s', symbol, {
      batchSize: batch.length,
      normalized: trades.length,
      skipped,
      added: result.added,
      deduplicated,
      dropped: result.dropped,
      bufferSize: instrument.trades.length,
    });

    if (result.dropped > 0) {
      log.warn('BitMEX trade buffer overflow for %s', symbol, { dropped: result.dropped });
    }
  }
}

function groupBySymbol(rows: BitmexTradeRaw[]): Map<string, BitmexTradeRaw[]> {
  const grouped = new Map<string, BitmexTradeRaw[]>();

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

function resolveInstrument(core: BitMex, symbol: string): Instrument | undefined {
  if (typeof symbol !== 'string') {
    return undefined;
  }

  const normalized = symbol.trim();

  if (!normalized) {
    return undefined;
  }

  return (
    core.instruments.get(normalized) ??
    core.instruments.get(normalized.toLowerCase()) ??
    core.instruments.get(normalized.toUpperCase())
  );
}

function normalizeBatch(rows: BitmexTradeRaw[]): { trades: Trade[]; skipped: number } {
  const normalized: { trade: Trade; index: number }[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const trade = normalizeTrade(row);

    if (!trade) {
      skipped += 1;
      return;
    }

    normalized.push({ trade, index });
  });

  normalized.sort((a, b) => {
    if (a.trade.ts === b.trade.ts) {
      return a.index - b.index;
    }

    return a.trade.ts - b.trade.ts;
  });

  return { trades: normalized.map(({ trade }) => trade), skipped };
}

function normalizeTrade(raw: BitmexTradeRaw): Trade | null {
  if (!raw || typeof raw.timestamp !== 'string' || typeof raw.side !== 'string') {
    return null;
  }

  const ts = Date.parse(raw.timestamp);

  if (!Number.isFinite(ts)) {
    return null;
  }

  let price: number | undefined;

  if (typeof raw.price === 'number' && Number.isFinite(raw.price)) {
    price = raw.price;
  } else if (
    typeof raw.foreignNotional === 'number' &&
    Number.isFinite(raw.foreignNotional) &&
    typeof raw.size === 'number' &&
    Number.isFinite(raw.size) &&
    raw.size !== 0
  ) {
    price = raw.foreignNotional / raw.size;
  }

  if (price === undefined || !Number.isFinite(price)) {
    return null;
  }

  const side = raw.side.toLowerCase() === 'sell' ? 'sell' : 'buy';

  const trade: Trade = {
    ts,
    side,
    price,
  };

  if (typeof raw.size === 'number' && Number.isFinite(raw.size)) {
    trade.size = raw.size;
  }

  if (typeof raw.trdMatchID === 'string' && raw.trdMatchID.trim().length > 0) {
    trade.id = raw.trdMatchID.trim();
  }

  if (typeof raw.foreignNotional === 'number' && Number.isFinite(raw.foreignNotional)) {
    trade.foreignNotional = raw.foreignNotional;
  }

  return trade;
}

function clampBufferSize(size: number): number {
  if (!Number.isFinite(size)) {
    return TRADE_BUFFER_MIN;
  }

  if (size < TRADE_BUFFER_MIN) {
    return TRADE_BUFFER_MIN;
  }

  if (size > TRADE_BUFFER_MAX) {
    return TRADE_BUFFER_MAX;
  }

  return Math.floor(size);
}
