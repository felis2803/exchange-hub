import { ValidationError } from './errors.js';

import type { ClOrdID, Symbol } from '../core/types.js';
import type { Side } from '../types.js';

export type OrderType = 'Market' | 'Limit' | 'Stop' | 'StopLimit';

export interface PlaceOpts {
  postOnly?: boolean;
  clOrdID?: ClOrdID;
  timeInForce?: string;
  reduceOnly?: boolean;
  stopLimitPrice?: number;
}

export interface PlaceValidationParams {
  symbol: Symbol;
  side: Side;
  size: number;
  price?: number;
  type: OrderType;
  opts?: PlaceOpts;
  bestBid?: number | null;
  bestAsk?: number | null;
}

export interface NormalizedPlaceOptions {
  postOnly: boolean;
  reduceOnly: boolean;
  timeInForce: string | null;
  clOrdId?: ClOrdID;
  stopLimitPrice: number | null;
}

export interface NormalizedPlaceInput {
  symbol: Symbol;
  side: Side;
  size: number;
  type: OrderType;
  price: number | null;
  stopPrice: number | null;
  options: NormalizedPlaceOptions;
}

export type PreparedPlaceInput = NormalizedPlaceInput & {
  options: NormalizedPlaceOptions & { clOrdId: ClOrdID };
};

function normalizeSymbol(symbol: Symbol): Symbol {
  if (typeof symbol !== 'string') {
    throw new ValidationError('Instrument symbol must be a string');
  }

  const trimmed = symbol.trim();
  if (!trimmed) {
    throw new ValidationError('Instrument symbol cannot be empty');
  }

  return trimmed as Symbol;
}

function normalizeSize(size: number): number {
  if (typeof size !== 'number' || Number.isNaN(size)) {
    throw new ValidationError('Order size must be a number', { details: { size } });
  }

  if (!Number.isFinite(size)) {
    throw new ValidationError('Order size must be finite', { details: { size } });
  }

  if (size <= 0) {
    throw new ValidationError('Order size must be greater than zero', { details: { size } });
  }

  return size;
}

function normalizePrice(price: number | null | undefined): number | null {
  if (price === undefined || price === null) {
    return null;
  }

  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new ValidationError('Price must be a finite number', { details: { price } });
  }

  return price;
}

function normalizeTimeInForce(timeInForce: string | undefined): string | null {
  if (typeof timeInForce !== 'string') {
    return null;
  }

  const trimmed = timeInForce.trim();
  return trimmed ? trimmed : null;
}

function normalizeClOrdId(clOrdID: ClOrdID | undefined): ClOrdID | undefined {
  if (typeof clOrdID !== 'string') {
    return undefined;
  }

  const trimmed = clOrdID.trim();
  if (!trimmed) {
    throw new ValidationError('clOrdID cannot be empty');
  }

  return trimmed as ClOrdID;
}

function normalizeFiniteNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}

export function validatePlaceInput(params: PlaceValidationParams): NormalizedPlaceInput {
  const { symbol, side, size, price, type, opts, bestBid, bestAsk } = params;

  if (side !== 'buy' && side !== 'sell') {
    throw new ValidationError('Order side must be "buy" or "sell"', { details: { side } });
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedSize = normalizeSize(size);
  const rawPrice = price ?? null;
  const normalizedBestBid = normalizeFiniteNumber(bestBid);
  const normalizedBestAsk = normalizeFiniteNumber(bestAsk);
  const normalizedStopLimitPrice = normalizePrice(opts?.stopLimitPrice);

  if (normalizedStopLimitPrice !== null && normalizedStopLimitPrice <= 0) {
    throw new ValidationError('stopLimitPrice must be a finite positive number', {
      details: { stopLimitPrice: opts?.stopLimitPrice },
    });
  }

  if (normalizedStopLimitPrice !== null && type !== 'StopLimit') {
    throw new ValidationError('stopLimitPrice is allowed for stop-limit orders only', {
      details: { type },
    });
  }

  let normalizedPrice: number | null = null;
  let normalizedStopPrice: number | null = null;

  if (type === 'Market') {
    if (rawPrice !== null) {
      throw new ValidationError('market order cannot include price', { details: { price } });
    }
  } else if (type === 'Limit') {
    if (
      rawPrice === null ||
      typeof rawPrice !== 'number' ||
      !Number.isFinite(rawPrice) ||
      rawPrice <= 0
    ) {
      throw new ValidationError('limit order requires a finite positive price', {
        details: { price },
      });
    }

    normalizedPrice = rawPrice;
  } else if (type === 'Stop') {
    const stopPrice = normalizePrice(rawPrice);

    if (stopPrice === null) {
      throw new ValidationError('stop orders require a price', { details: { price } });
    }

    if (stopPrice <= 0) {
      throw new ValidationError('stop price must be greater than zero', { details: { price } });
    }

    normalizedStopPrice = stopPrice;

    if (side === 'buy' && normalizedBestAsk !== null && stopPrice < normalizedBestAsk) {
      throw new ValidationError('buy stop price must be greater than or equal to best ask', {
        details: { stopPrice, bestAsk: normalizedBestAsk },
      });
    }

    if (side === 'sell' && normalizedBestBid !== null && stopPrice > normalizedBestBid) {
      throw new ValidationError('sell stop price must be less than or equal to best bid', {
        details: { stopPrice, bestBid: normalizedBestBid },
      });
    }
  } else if (type === 'StopLimit') {
    const stopPrice = normalizePrice(rawPrice);

    if (stopPrice === null) {
      throw new ValidationError('stop-limit orders require a stop price', {
        details: { price },
      });
    }

    if (stopPrice <= 0) {
      throw new ValidationError('stop-limit orders require a positive stop price', {
        details: { price },
      });
    }

    if (side === 'buy' && normalizedBestAsk !== null && stopPrice < normalizedBestAsk) {
      throw new ValidationError('buy stop price must be greater than or equal to best ask', {
        details: { stopPrice, bestAsk: normalizedBestAsk },
      });
    }

    if (side === 'sell' && normalizedBestBid !== null && stopPrice > normalizedBestBid) {
      throw new ValidationError('sell stop price must be less than or equal to best bid', {
        details: { stopPrice, bestBid: normalizedBestBid },
      });
    }

    if (normalizedStopLimitPrice === null) {
      throw new ValidationError('stop-limit orders require a limit price', {
        details: { stopLimitPrice: opts?.stopLimitPrice },
      });
    }

    normalizedStopPrice = stopPrice;
    normalizedPrice = normalizedStopLimitPrice;
  }

  const postOnly = Boolean(opts?.postOnly);
  if (postOnly && type !== 'Limit') {
    throw new ValidationError('postOnly is allowed for limit orders only', {
      details: { type, postOnly },
    });
  }

  const reduceOnly = Boolean(opts?.reduceOnly);
  const timeInForce = normalizeTimeInForce(opts?.timeInForce);
  const clOrdId = normalizeClOrdId(opts?.clOrdID);

  return {
    symbol: normalizedSymbol,
    side,
    size: normalizedSize,
    type,
    price: type === 'Limit' || type === 'StopLimit' ? normalizedPrice : null,
    stopPrice: type === 'Stop' || type === 'StopLimit' ? normalizedStopPrice : null,
    options: {
      postOnly,
      reduceOnly,
      timeInForce,
      stopLimitPrice: type === 'StopLimit' ? normalizedPrice : null,
      ...(clOrdId ? { clOrdId } : {}),
    },
  };
}
