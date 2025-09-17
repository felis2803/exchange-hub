import { createLogger } from './infra/logger.js';

const log = createLogger('exchange-hub');
log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel } from './infra/logger.js';
export type { LogLevel, Logger } from './infra/logger.js';
export {
  BaseError,
  NetworkError,
  AuthError,
  RateLimitError,
  ValidationError,
  OrderRejectedError,
  ExchangeDownError,
  TimeoutError,
  fromHttpResponse,
  fromFetchError,
  fromWsClose,
  wrap,
  isRetryable,
} from './infra/errors.js';
export type { ErrorCode, ErrorJSON, ErrorOptions, ErrorExtras } from './infra/errors.js';
