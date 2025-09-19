import { createLogger, LOG_TAGS, type Logger } from '../../../infra/logger.js';
import {
  BaseError,
  ExchangeDownError,
  NetworkError,
  ValidationError,
} from '../../../infra/errors.js';
import { BitmexRestClient } from './request.js';

import type { BitMexOrder, BitMexSide } from '../types.js';

export interface CreateOrderPayload {
  symbol: string;
  side: BitMexSide;
  orderQty: number;
  ordType: 'Market' | 'Limit';
  price?: number;
  clOrdID: string;
  stopPx?: number;
  execInst?: string;
  timeInForce?: string;
}

export interface CreateOrderOptions {
  client: BitmexRestClient;
  timeoutMs?: number;
  logger?: Logger;
}

const RETRYABLE_CODES = new Set<BaseError['code']>(['NETWORK_ERROR', 'EXCHANGE_DOWN']);
const MAX_RETRIES = 1; // retry attempts on top of the initial try
const RETRY_DELAY_MS = 150;

export async function createOrder(
  payload: CreateOrderPayload,
  options: CreateOrderOptions,
): Promise<BitMexOrder> {
  validatePayload(payload);

  const sanitizedPayload = stripUndefined({ ...payload });

  const logger = options.logger ?? createLogger('bitmex:rest:orders').withTags([LOG_TAGS.order]);
  const context = {
    symbol: sanitizedPayload.symbol,
    side: sanitizedPayload.side,
    ordType: sanitizedPayload.ordType,
    clOrdID: sanitizedPayload.clOrdID,
    timeInForce: sanitizedPayload.timeInForce ?? null,
    execInstPresent: Boolean(sanitizedPayload.execInst),
  } as const;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition -- controlled by return/throw inside loop
  while (true) {
    try {
      if (attempt === 0) {
        logger.debug('BitMEX REST create order attempt %d', attempt + 1, context);
      } else {
        logger.warn('BitMEX REST create order retry attempt %d', attempt + 1, context);
      }

      const response = await options.client.request<BitMexOrder>('POST', '/api/v1/order', {
        auth: true,
        timeoutMs: options.timeoutMs,
        body: sanitizedPayload,
      });

      logger.info('BitMEX REST create order success', { ...context, attempt: attempt + 1 });
      return response;
    } catch (error) {
      if (shouldRetry(error, attempt)) {
        const baseError = error as BaseError;
        logger.warn('BitMEX REST create order attempt failed: %s', baseError.message, {
          ...context,
          attempt: attempt + 1,
          code: baseError.code,
        });
        attempt += 1;
        await delay(RETRY_DELAY_MS);
        continue;
      }

      if (error instanceof BaseError) {
        logger.error('BitMEX REST create order failed: %s', error.message, {
          ...context,
          attempt: attempt + 1,
          code: error.code,
        });
      } else if (error instanceof Error) {
        logger.error('BitMEX REST create order failed: %s', error.message, {
          ...context,
          attempt: attempt + 1,
        });
      } else {
        logger.error('BitMEX REST create order failed', {
          ...context,
          attempt: attempt + 1,
          error,
        });
      }

      throw error;
    }
  }
}

function validatePayload(payload: CreateOrderPayload): void {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Order payload must be an object');
  }

  if (typeof payload.symbol !== 'string' || payload.symbol.trim().length === 0) {
    throw new ValidationError('Order symbol must be a non-empty string', {
      details: { symbol: payload.symbol },
    });
  }

  if (payload.side !== 'Buy' && payload.side !== 'Sell') {
    throw new ValidationError('Order side must be "Buy" or "Sell"', {
      details: { side: payload.side },
    });
  }

  if (typeof payload.orderQty !== 'number' || !Number.isFinite(payload.orderQty) || payload.orderQty <= 0) {
    throw new ValidationError('Order quantity must be a positive number', {
      details: { orderQty: payload.orderQty },
    });
  }

  if (payload.ordType !== 'Market' && payload.ordType !== 'Limit') {
    throw new ValidationError('Order type must be "Market" or "Limit"', {
      details: { ordType: payload.ordType },
    });
  }

  if (payload.ordType === 'Limit') {
    if (
      typeof payload.price !== 'number' ||
      !Number.isFinite(payload.price) ||
      payload.price <= 0
    ) {
      throw new ValidationError('Limit orders require a finite price', {
        details: { price: payload.price },
      });
    }
  } else if (payload.price !== undefined) {
    throw new ValidationError('Market orders must not include price', {
      details: { price: payload.price },
    });
  }

  if (typeof payload.clOrdID !== 'string' || payload.clOrdID.trim().length === 0) {
    throw new ValidationError('clOrdID must be a non-empty string', {
      details: { clOrdID: payload.clOrdID },
    });
  }

  if (payload.stopPx !== undefined) {
    throw new ValidationError('stop orders are not supported yet', {
      details: { stopPx: payload.stopPx },
    });
  }

  if (payload.execInst !== undefined && typeof payload.execInst !== 'string') {
    throw new ValidationError('execInst must be a string when provided', {
      details: { execInst: payload.execInst },
    });
  }

  if (payload.timeInForce !== undefined && typeof payload.timeInForce !== 'string') {
    throw new ValidationError('timeInForce must be a string when provided', {
      details: { timeInForce: payload.timeInForce },
    });
  }
}

function shouldRetry(error: unknown, attempt: number): error is BaseError {
  if (attempt >= MAX_RETRIES) {
    return false;
  }

  if (!(error instanceof BaseError)) {
    return false;
  }

  if (error instanceof NetworkError || error instanceof ExchangeDownError) {
    return true;
  }

  return RETRYABLE_CODES.has(error.code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripUndefined<T extends Record<string, unknown>>(object: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) {
      continue;
    }

    if (key === 'execInst' && typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      result[key] = trimmed;
      continue;
    }

    result[key] = value;
  }

  return result as T;
}
