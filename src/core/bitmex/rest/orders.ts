import { createLogger, LOG_TAGS, type Logger } from '../../../infra/logger.js';
import { BaseError } from '../../../infra/errors.js';

import { BitmexRestClient } from './request.js';

import type { BitMexOrder, BitMexOrderType, BitMexTimeInForce } from '../types.js';

export type CreateOrderPayload = {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderQty: number;
  ordType: BitMexOrderType;
  price?: number;
  clOrdID?: string;
  stopPx?: number;
  execInst?: string;
  timeInForce?: BitMexTimeInForce;
};

export interface CreateOrderOptions {
  timeoutMs?: number;
}

export interface BitmexRestOrders {
  createOrder(payload: CreateOrderPayload, opts?: CreateOrderOptions): Promise<BitMexOrder>;
}

export interface BitmexRestOrdersOptions {
  logger?: Logger;
  defaultTimeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 7_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;

export function createBitmexRestOrders(
  client: BitmexRestClient,
  options: BitmexRestOrdersOptions = {},
): BitmexRestOrders {
  const baseLogger = options.logger ?? createLogger('bitmex:rest:orders');
  const log = baseLogger.withTags([LOG_TAGS.order]);
  const maxRetries = normalizeRetries(options.maxRetries);
  const defaultTimeout = normalizeTimeout(options.defaultTimeoutMs);

  async function createOrder(
    payload: CreateOrderPayload,
    opts: CreateOrderOptions = {},
  ): Promise<BitMexOrder> {
    const timeoutMs = normalizeTimeout(opts.timeoutMs ?? defaultTimeout);
    const totalAttempts = 1 + maxRetries;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      try {
        log.debug('BitMEX REST create order attempt %d', attempt + 1, {
          symbol: payload.symbol,
          side: payload.side,
          ordType: payload.ordType,
          attempt: attempt + 1,
          totalAttempts,
        });

        return await client.request<BitMexOrder>('POST', '/api/v1/order', {
          auth: true,
          body: payload,
          timeoutMs,
        });
      } catch (error) {
        if (!shouldRetry(error) || attempt >= totalAttempts - 1) {
          log.error('BitMEX REST create order failed', {
            symbol: payload.symbol,
            side: payload.side,
            ordType: payload.ordType,
            attempt: attempt + 1,
            totalAttempts,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        log.warn('BitMEX REST create order retrying after error', {
          symbol: payload.symbol,
          side: payload.side,
          ordType: payload.ordType,
          attempt: attempt + 1,
          totalAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error('BitMEX REST create order exhausted attempts');
  }

  return { createOrder };
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof BaseError)) {
    return false;
  }

  return error.category === 'NETWORK_ERROR' || error.category === 'EXCHANGE_DOWN';
}

function normalizeTimeout(candidate?: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (candidate < MIN_TIMEOUT_MS) {
    return MIN_TIMEOUT_MS;
  }

  if (candidate > MAX_TIMEOUT_MS) {
    return MAX_TIMEOUT_MS;
  }

  return candidate;
}

function normalizeRetries(candidate?: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_MAX_RETRIES;
  }

  return Math.min(DEFAULT_MAX_RETRIES, Math.trunc(candidate));
}
