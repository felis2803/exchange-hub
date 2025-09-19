import { createLogger } from './infra/logger.js';

const log = createLogger('exchange-hub');
log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel, LOG_TAGS } from './infra/logger.js';
export type { LogLevel, Logger } from './infra/logger.js';
export {
  BaseError,
  NetworkError,
  AuthError,
  AuthTimeoutError,
  AuthBadCredentialsError,
  AuthClockSkewError,
  RateLimitError,
  ValidationError,
  OrderRejectedError,
  ExchangeDownError,
  TimeoutError,
  fromHttpResponse,
  fromFetchError,
  fromWsClose,
  wrap,
} from './infra/errors.js';
export type { ErrorCode, AuthErrorCode, ErrorJSON, ErrorOptions } from './infra/errors.js';
export {
  incrementCounter,
  observeHistogram,
  getCounterValue,
  getHistogramValues,
  resetMetrics,
} from './infra/metrics.js';
export {
  getBitmexCredentials,
  getAuthExpiresSkewSec,
  DEFAULT_AUTH_EXPIRES_SKEW_SEC,
} from './config/bitmex.js';
export type {
  Symbol,
  AccountId,
  OrderID,
  ClOrdID,
  TimestampISO,
  Liquidity,
  DomainUpdate,
  BaseEntity,
} from './core/types.js';
export { diffKeys } from './infra/diff.js';
export { dedupeByKey } from './infra/dedupe.js';
export { toIso, parseIsoTs, isNewerByTimestamp, normalizeWsTs } from './infra/time.js';
export type { PrivateResubscribeFlow } from './core/private/resubscribe-flow.js';
export { DefaultPrivateResubscribeFlow } from './core/private/resubscribe-flow.js';
export { METRICS as PRIVATE_METRICS } from './infra/metrics-private.js';
export type { PrivateLabels } from './infra/metrics-private.js';
