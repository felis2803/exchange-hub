import { createLogger, type Logger } from '../../../infra/logger.js';
import { ExchangeDownError, NetworkError } from '../../../infra/errors.js';

import type { BitMexOrder, BitMexOrderType, BitMexSide, BitMexTimeInForce } from '../types.js';

import { BitmexRestClient } from './request.js';

export interface CreateOrderPayload {
  symbol: string;
  side: BitMexSide;
  orderQty: number;
  ordType: Extract<BitMexOrderType, 'Market' | 'Limit' | 'Stop'>;
  clOrdID: string;
  price?: number;
  stopPx?: number;
  execInst?: string;
  timeInForce?: BitMexTimeInForce;
}

export interface CreateOrderOptions {
  timeoutMs?: number;
  retries?: number;
  logger?: Logger;
}

export const BITMEX_CREATE_ORDER_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 1;

const log = createLogger('bitmex:rest:orders');

export async function createOrder(
  client: BitmexRestClient,
  payload: CreateOrderPayload,
  options: CreateOrderOptions = {},
): Promise<BitMexOrder> {
  const { timeoutMs = BITMEX_CREATE_ORDER_TIMEOUT_MS, retries = DEFAULT_RETRIES, logger } = options;
  const attemptLogger = logger ?? log;
  const body: Record<string, unknown> = {
    symbol: payload.symbol,
    side: payload.side,
    orderQty: payload.orderQty,
    ordType: payload.ordType,
    clOrdID: payload.clOrdID,
  };

  if (payload.price !== undefined) {
    body.price = payload.price;
  }
  if (payload.stopPx !== undefined) {
    body.stopPx = payload.stopPx;
  }
  if (payload.execInst) {
    body.execInst = payload.execInst;
  }
  if (payload.timeInForce) {
    body.timeInForce = payload.timeInForce;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
    try {
      return await client.request<BitMexOrder>('POST', '/api/v1/order', {
        auth: true,
        body,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;

      if (!(error instanceof NetworkError || error instanceof ExchangeDownError)) {
        throw error;
      }

      if (attempt >= retries) {
        throw error;
      }

      attemptLogger.warn('BitMEX createOrder retry %d/%d after %s', attempt + 1, retries, error.message, {
        attempt: attempt + 1,
        retries,
        code: error.code,
        clOrdID: payload.clOrdID,
        symbol: payload.symbol,
      });
    }
  }

  throw lastError instanceof Error ? lastError : new NetworkError('BitMEX createOrder failed');
}
