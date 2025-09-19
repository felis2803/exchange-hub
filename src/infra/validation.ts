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

function normalizePrice(price: number | undefined): number | null {
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

function normalizeContextPrice(value: number | null | undefined): number | null {
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
  const normalizedInputPrice = normalizePrice(price);
  const normalizedStopLimitPrice = normalizePrice(opts?.stopLimitPrice);

  let normalizedType: OrderType = type;
  if (normalizedType === 'Stop' && normalizedStopLimitPrice !== null) {
    normalizedType = 'StopLimit';
  }

  if (normalizedType === 'StopLimit' && normalizedStopLimitPrice === null) {
    throw new ValidationError('Stop-limit orders require a limit price', {
      details: { stopLimitPrice: opts?.stopLimitPrice },
    });
  }

  const postOnly = Boolean(opts?.postOnly);
  if (postOnly && normalizedType !== 'Limit') {
    throw new ValidationError('postOnly flag is allowed only for limit orders', {
      details: { type: normalizedType, postOnly },
    });
  }

  const reduceOnly = Boolean(opts?.reduceOnly);
  const timeInForce = normalizeTimeInForce(opts?.timeInForce);
  const clOrdId = normalizeClOrdId(opts?.clOrdID);

  const normalizedBestBid = normalizeContextPrice(bestBid);
  const normalizedBestAsk = normalizeContextPrice(bestAsk);

  let limitPrice: number | null = null;
  let stopPrice: number | null = null;

  switch (normalizedType) {
    case 'Market':
      if (normalizedInputPrice !== null) {
        throw new ValidationError('Market orders cannot have a price', { details: { price } });
      }

      if (normalizedStopLimitPrice !== null) {
        throw new ValidationError('stopLimitPrice is not supported for market orders', {
          details: { stopLimitPrice: opts?.stopLimitPrice },
        });
      }
      break;
    case 'Limit':
      if (normalizedInputPrice === null) {
        throw new ValidationError('Limit orders require a price', { details: { price } });
      }

      if (normalizedStopLimitPrice !== null) {
        throw new ValidationError('stopLimitPrice is only valid for stop orders', {
          details: { stopLimitPrice: opts?.stopLimitPrice },
        });
      }

      limitPrice = normalizedInputPrice;
      break;
    case 'Stop':
      if (normalizedInputPrice === null) {
        throw new ValidationError('Stop orders require a stop price', { details: { price } });
      }

      if (normalizedStopLimitPrice !== null) {
        throw new ValidationError('stopLimitPrice requires stop-limit order type', {
          details: { stopLimitPrice: opts?.stopLimitPrice },
        });
      }

      stopPrice = normalizedInputPrice;
      break;
    case 'StopLimit':
      if (normalizedInputPrice === null) {
        throw new ValidationError('Stop-limit orders require a stop price', { details: { price } });
      }

      // normalizedStopLimitPrice is guaranteed not to be null above.
      stopPrice = normalizedInputPrice;
      limitPrice = normalizedStopLimitPrice;
      break;
    default:
      break;
  }

  if ((normalizedType === 'Stop' || normalizedType === 'StopLimit') && stopPrice !== null) {
    if (side === 'buy' && normalizedBestAsk !== null && stopPrice < normalizedBestAsk) {
      throw new ValidationError('Buy stop price must be greater than or equal to best ask', {
        details: { side, stopPrice, bestAsk: normalizedBestAsk },
      });
    }

    if (side === 'sell' && normalizedBestBid !== null && stopPrice > normalizedBestBid) {
      throw new ValidationError('Sell stop price must be less than or equal to best bid', {
        details: { side, stopPrice, bestBid: normalizedBestBid },
      });
    }
  }

  return {
    symbol: normalizedSymbol,
    side,
    size: normalizedSize,
    type: normalizedType,
    price: limitPrice,
    stopPrice,
    options: {
      postOnly,
      reduceOnly,
      timeInForce,
      ...(clOrdId ? { clOrdId } : {}),
    },
  };
}
