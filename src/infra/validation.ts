import { ValidationError } from './errors.js';

import type { ClOrdID, Symbol } from '../core/types.js';
import type { Side } from '../types.js';

export type OrderType = 'Market' | 'Limit' | 'Stop';

export interface PlaceOpts {
  postOnly?: boolean;
  clOrdID?: ClOrdID;
  timeInForce?: string;
  reduceOnly?: boolean;
}

export interface PlaceValidationParams {
  symbol: Symbol;
  side: Side;
  size: number;
  price?: number;
  type: OrderType;
  opts?: PlaceOpts;
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

export function validatePlaceInput(params: PlaceValidationParams): NormalizedPlaceInput {
  const { symbol, side, size, price, type, opts } = params;

  if (side !== 'buy' && side !== 'sell') {
    throw new ValidationError('order side must be "buy" or "sell"', { details: { side } });
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedSize = normalizeSize(size);
  const normalizedPrice = normalizePrice(price);

  if (type === 'Stop') {
    throw new ValidationError('stop orders are not supported yet', { details: { type } });
  }

  if (type !== 'Market' && type !== 'Limit') {
    throw new ValidationError('order type is not supported', { details: { type } });
  }

  const postOnly = Boolean(opts?.postOnly);
  const reduceOnly = Boolean(opts?.reduceOnly);
  const timeInForce = normalizeTimeInForce(opts?.timeInForce);
  const clOrdId = normalizeClOrdId(opts?.clOrdID);

  if (type === 'Market') {
    if (normalizedPrice !== null) {
      throw new ValidationError('market orders cannot include price', { details: { price } });
    }
    if (postOnly) {
      throw new ValidationError('market orders cannot be post only', {
        details: { type, postOnly },
      });
    }
  }

  if (type === 'Limit') {
    if (normalizedPrice === null) {
      throw new ValidationError('limit orders require price', { details: { price } });
    }

    if (!(normalizedPrice > 0)) {
      throw new ValidationError('limit order price must be positive', {
        details: { price: normalizedPrice },
      });
    }
  }

  if (postOnly && type !== 'Limit') {
    throw new ValidationError('post only flag is allowed only for limit orders', {
      details: { type, postOnly },
    });
  }

  if (postOnly && timeInForce && isImmediateOrCancel(timeInForce)) {
    throw new ValidationError('post only cannot be combined with ioc or fok', {
      details: { postOnly, timeInForce },
    });
  }

  return {
    symbol: normalizedSymbol,
    side,
    size: normalizedSize,
    type,
    price: type === 'Limit' ? normalizedPrice : null,
    stopPrice: null,
    options: {
      postOnly,
      reduceOnly,
      timeInForce,
      ...(clOrdId ? { clOrdId } : {}),
    },
  };
}

function isImmediateOrCancel(timeInForce: string): boolean {
  const normalized = timeInForce.trim().toLowerCase();

  return (
    normalized === 'immediateorcancel' ||
    normalized === 'ioc' ||
    normalized === 'fillorkill' ||
    normalized === 'fok'
  );
}
