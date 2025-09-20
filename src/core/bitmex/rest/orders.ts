import { createLogger, type Logger } from '../../../infra/logger.js';
import {
  incrementCounter,
  observeHistogram,
  type MetricLabelValue,
} from '../../../infra/metrics.js';
import { BaseError, ExchangeDownError, NetworkError } from '../../../infra/errors.js';

import type { BitMexOrder, BitMexOrderType, BitMexSide, BitMexTimeInForce } from '../types.js';

import type { BitmexRestClient } from './request.js';

export interface CreateOrderPayload {
  symbol: string;
  side: BitMexSide;
  orderQty: number;
  ordType: Extract<BitMexOrderType, 'Market' | 'Limit' | 'Stop' | 'StopLimit'>;
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

const CREATE_ORDER_LATENCY_METRIC = 'create_order_latency_ms';
const CREATE_ORDER_ERROR_COUNTER = 'create_order_errors_total';

const log = createLogger('bitmex:rest:orders');

export async function createOrder(
  client: BitmexRestClient,
  payload: CreateOrderPayload,
  options: CreateOrderOptions = {},
): Promise<BitMexOrder> {
  const { timeoutMs = BITMEX_CREATE_ORDER_TIMEOUT_MS, retries = DEFAULT_RETRIES, logger } = options;
  const attemptLogger = logger ?? log;
  const allowedRetries = Math.max(0, retries);
  const maxAttempts = allowedRetries + 1;
  const startedAt = Date.now();
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

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptNumber = attempt + 1;
    try {
      const result = await client.request<BitMexOrder>('POST', '/api/v1/order', {
        auth: true,
        body,
        timeoutMs,
      });
      const elapsedMs = Date.now() - startedAt;
      attemptLogger.info(
        'BitMEX createOrder success after %d attempt(s) in %dms',
        attemptNumber,
        elapsedMs,
        {
          attempt: attemptNumber,
          attemptCount: maxAttempts,
          maxAttempts,
          elapsedMs,
          latencyMs: elapsedMs,
          timeoutMs,
          clOrdID: payload.clOrdID,
          symbol: payload.symbol,
        },
      );
      observeHistogram(CREATE_ORDER_LATENCY_METRIC, elapsedMs, {
        exchange: 'BitMEX',
        symbol: payload.symbol,
      });
      return result;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : typeof error;
      const httpStatus = error instanceof BaseError ? error.httpStatus : undefined;
      const code = error instanceof BaseError ? error.code : undefined;

      const isRetryable = error instanceof NetworkError || error instanceof ExchangeDownError;
      const shouldRetry = isRetryable && attempt < allowedRetries;
      const logFn = shouldRetry ? attemptLogger.warn : attemptLogger.error;

      logFn(
        'BitMEX createOrder attempt %d/%d failed after %dms: %s',
        attemptNumber,
        maxAttempts,
        elapsedMs,
        errorMessage,
        {
          attempt: attemptNumber,
          attemptCount: maxAttempts,
          maxAttempts,
          elapsedMs,
          timeoutMs,
          clOrdID: payload.clOrdID,
          symbol: payload.symbol,
          errorName,
          httpStatus,
          code,
          willRetry: shouldRetry,
        },
      );

      if (!shouldRetry) {
        const labels = {
          exchange: 'BitMEX',
          symbol: payload.symbol,
          error: errorName,
          code: error instanceof BaseError ? error.category : 'UNKNOWN_ERROR',
        } as Record<string, MetricLabelValue>;

        if (httpStatus !== undefined) {
          labels.httpStatus = httpStatus;
        }

        incrementCounter(CREATE_ORDER_ERROR_COUNTER, 1, labels);
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new NetworkError('BitMEX createOrder failed');
}

export async function getOrderByClOrdId(
  client: BitmexRestClient,
  clOrdID: string,
  options: Pick<CreateOrderOptions, 'timeoutMs' | 'logger'> = {},
): Promise<BitMexOrder | undefined> {
  const { timeoutMs = BITMEX_CREATE_ORDER_TIMEOUT_MS, logger } = options;
  const requestLogger = logger ?? log;
  const startedAt = Date.now();

  try {
    const rows = await client.request<BitMexOrder[]>('GET', '/api/v1/order', {
      auth: true,
      timeoutMs,
      qs: { clOrdID },
    });
    const elapsedMs = Date.now() - startedAt;

    requestLogger.info('BitMEX getOrder by clOrdID=%s succeeded in %dms', clOrdID, elapsedMs, {
      clOrdID,
      elapsedMs,
      timeoutMs,
      symbol: rows?.[0]?.symbol,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      return undefined;
    }

    return rows[0];
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : typeof error;
    const httpStatus = error instanceof BaseError ? error.httpStatus : undefined;
    const code = error instanceof BaseError ? error.code : undefined;

    requestLogger.error(
      'BitMEX getOrder by clOrdID=%s failed after %dms: %s',
      clOrdID,
      elapsedMs,
      errorMessage,
      {
        clOrdID,
        elapsedMs,
        timeoutMs,
        errorName,
        httpStatus,
        code,
      },
    );

    throw error;
  }
}
