import { createLogger } from '../../../infra/logger.js';
import { mapSymbolNativeToUni } from '../../../utils/symbolMapping.js';

import { TRADE_BUFFER_MAX, TRADE_BUFFER_MIN } from '../constants.js';

import type { Instrument } from '../../../domain/instrument.js';
import type { BitmexTrade, BitmexTradeRaw } from '../../../types/bitmex.js';
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
    const limited = trades.length > capacity ? trades.slice(trades.length - capacity) : trades;
    const trimmed = trades.length - limited.length;
    const result = instrument.trades.push(limited, { reset: true });

    log.info('BitMEX trade partial snapshot for %s', symbol, {
      total: batch.length,
      accepted: trades.length,
      stored: limited.length,
      skipped,
      trimmed,
    });

    if (trimmed > 0 || result.dropped > 0) {
      log.warn('BitMEX trade partial trimmed buffer for %s', symbol, {
        trimmed,
        dropped: result.dropped,
      });
    }
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

    log.debug('BitMEX trade insert for %s', symbol, {
      total: batch.length,
      accepted: trades.length,
      skipped,
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
  const byNative = core.getInstrumentByNative(symbol);

  if (byNative) {
    return byNative;
  }

  if (!core.symbolMappingEnabled) {
    return undefined;
  }

  const unified = mapSymbolNativeToUni(symbol, { enabled: core.symbolMappingEnabled });

  if (!unified) {
    return undefined;
  }

  return core.instruments.get(unified);
}

function normalizeBatch(rows: BitmexTradeRaw[]): { trades: BitmexTrade[]; skipped: number } {
  const normalized: BitmexTrade[] = [];
  let skipped = 0;

  for (const row of rows) {
    const trade = normalizeTrade(row);

    if (!trade) {
      skipped += 1;
      continue;
    }

    normalized.push(trade);
  }

  normalized.sort((a, b) => a.ts - b.ts);

  return { trades: normalized, skipped };
}

function normalizeTrade(raw: BitmexTradeRaw): BitmexTrade | null {
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

  const trade: BitmexTrade = {
    ts,
    side,
    price,
  };

  if (typeof raw.size === 'number' && Number.isFinite(raw.size)) {
    trade.size = raw.size;
  }

  if (raw.trdMatchID) {
    trade.id = raw.trdMatchID;
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
