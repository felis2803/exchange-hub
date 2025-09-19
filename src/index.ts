import { createLogger } from './infra/logger.js';

const log = createLogger('exchange-hub');
log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel } from './infra/logger.js';
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
