import { createLogger } from './infra/logger';

const log = createLogger('exchange-hub');

log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel, LOG_TAGS } from './infra/logger';
export type { LogLevel, Logger } from './infra/logger';
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
} from './infra/errors';
export type { ErrorCode, AuthErrorCode, ErrorJSON, ErrorOptions } from './infra/errors';
export { incrementCounter, observeHistogram, getCounterValue, getHistogramValues, resetMetrics } from './infra/metrics';
export { getBitmexCredentials, getAuthExpiresSkewSec, DEFAULT_AUTH_EXPIRES_SKEW_SEC } from './config/bitmex';
export type {
    Symbol,
    AccountId,
    OrderID,
    ClOrdID,
    TimestampISO,
    Liquidity,
    DomainUpdate,
    BaseEntity,
} from './core/types';
export { diffKeys } from './infra/diff';
export { dedupeByKey } from './infra/dedupe';
export { toIso, parseIsoTs, isNewerByTimestamp, normalizeWsTs } from './infra/time';
export type { PrivateResubscribeFlow } from './core/private/resubscribe-flow';
export { DefaultPrivateResubscribeFlow } from './core/private/resubscribe-flow';
export { METRICS as PRIVATE_METRICS } from './infra/metrics-private';
export type { PrivateLabels } from './infra/metrics-private';
