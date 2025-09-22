/**
 * ExchangeHub error hierarchy and helpers.
 * Compatible with Node.js 22 (ESM + TypeScript).
 */

export type ErrorCode =
    | 'NETWORK_ERROR'
    | 'AUTH_ERROR'
    | 'RATE_LIMIT'
    | 'VALIDATION_ERROR'
    | 'ORDER_REJECTED'
    | 'EXCHANGE_DOWN'
    | 'TIMEOUT'
    | 'UNKNOWN_ERROR';

export type AuthErrorCode = 'BAD_CREDENTIALS' | 'CLOCK_SKEW' | 'TIMEOUT' | 'ALREADY_AUTHED' | 'NETWORK';

export interface ErrorJSON {
    name: string;
    code: ErrorCode | AuthErrorCode;
    category: ErrorCode;
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
    exchange?: string;
    requestId?: string;
    details?: Record<string, unknown>;
    cause?: string;
    stack?: string;
}

export interface ErrorOptions {
    code: ErrorCode;
    message?: string;
    cause?: unknown;
    details?: Record<string, unknown>;
    httpStatus?: number;
    retryAfterMs?: number;
    exchange?: string;
    requestId?: string;
}

type ErrorOverrides = Partial<Omit<ErrorOptions, 'code'>>;

export class BaseError extends Error {
    public readonly category: ErrorCode;
    public override readonly cause?: unknown;
    public readonly details?: Record<string, unknown>;
    public readonly httpStatus?: number;
    public readonly retryAfterMs?: number;
    public readonly exchange?: string;
    public readonly requestId?: string;

    constructor(opts: ErrorOptions) {
        const message = opts.message ?? opts.code;

        super(message);

        this.name = new.target.name;
        this.category = opts.code;
        this.cause = opts.cause;
        this.details = opts.details;
        this.httpStatus = opts.httpStatus;
        this.retryAfterMs = opts.retryAfterMs;
        this.exchange = opts.exchange;
        this.requestId = opts.requestId;

        const captureStackTrace = (Error as { captureStackTrace?: CaptureStackTraceFn }).captureStackTrace;

        if (captureStackTrace) {
            captureStackTrace(this, new.target as ErrorConstructorFn);
        }

        Object.setPrototypeOf(this, new.target.prototype);
    }

    get code(): ErrorCode | AuthErrorCode {
        return this.category;
    }

    isRetryable(): boolean {
        switch (this.category) {
            case 'NETWORK_ERROR':
            case 'RATE_LIMIT':
            case 'EXCHANGE_DOWN':
            case 'TIMEOUT':
                return true;
            default:
                return false;
        }
    }

    toJSON(): ErrorJSON {
        return {
            name: this.name,
            code: this.code,
            category: this.category,
            message: this.message,
            httpStatus: this.httpStatus,
            retryAfterMs: this.retryAfterMs,
            exchange: this.exchange,
            requestId: this.requestId,
            details: this.details ? sanitizeRecord(this.details) : undefined,
            cause: formatCause(this.cause),
            stack: this.stack,
        };
    }
}

export class NetworkError extends BaseError {
    constructor(message = 'Network error', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'NETWORK_ERROR', message, ...opts });
    }
}

export class AuthError extends BaseError {
    public readonly authCode: AuthErrorCode;

    constructor(
        message = 'Authentication error',
        code: AuthErrorCode = 'NETWORK',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ) {
        super({ code: 'AUTH_ERROR', message, ...opts });
        this.authCode = code;
    }

    override get code(): AuthErrorCode {
        return this.authCode;
    }

    static badCredentials(
        message = 'Authentication failed: bad credentials',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ): AuthError {
        return new AuthError(message, 'BAD_CREDENTIALS', opts);
    }

    static clockSkew(
        message = 'Authentication failed: clock skew detected',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ): AuthError {
        return new AuthError(message, 'CLOCK_SKEW', opts);
    }

    static timeout(message = 'Authentication timed out', opts: Omit<ErrorOptions, 'code' | 'message'> = {}): AuthError {
        return new AuthError(message, 'TIMEOUT', opts);
    }

    static alreadyAuthed(
        message = 'Authentication already active',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ): AuthError {
        return new AuthError(message, 'ALREADY_AUTHED', opts);
    }

    static network(
        message = 'Authentication failed due to network error',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ): AuthError {
        return new AuthError(message, 'NETWORK', opts);
    }
}

export class AuthTimeoutError extends AuthError {
    constructor(message = 'Authentication timed out', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super(message, 'TIMEOUT', opts);
    }
}

export class AuthBadCredentialsError extends AuthError {
    constructor(message = 'Authentication failed: bad credentials', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super(message, 'BAD_CREDENTIALS', opts);
    }
}

export class AuthClockSkewError extends AuthError {
    constructor(
        message = 'Authentication failed: clock skew detected',
        opts: Omit<ErrorOptions, 'code' | 'message'> = {},
    ) {
        super(message, 'CLOCK_SKEW', opts);
    }
}

export class RateLimitError extends BaseError {
    constructor(message = 'Rate limit exceeded', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'RATE_LIMIT', message, ...opts });
    }
}

export class ValidationError extends BaseError {
    constructor(message = 'Validation error', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'VALIDATION_ERROR', message, ...opts });
    }
}

export class OrderRejectedError extends BaseError {
    constructor(message = 'Order rejected', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'ORDER_REJECTED', message, ...opts });
    }
}

export class ExchangeDownError extends BaseError {
    constructor(message = 'Exchange is unavailable', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'EXCHANGE_DOWN', message, ...opts });
    }
}

export class TimeoutError extends BaseError {
    constructor(message = 'Operation timed out', opts: Omit<ErrorOptions, 'code' | 'message'> = {}) {
        super({ code: 'TIMEOUT', message, ...opts });
    }
}

export interface HttpResponseErrorParams {
    status: number;
    body?: unknown;
    headers?: HeadersLike;
    url?: string;
    method?: string;
    exchange?: string;
    requestId?: string;
}

export interface WsCloseParams {
    code: number;
    reason?: string;
    exchange?: string;
}

type HeadersLike = Record<string, string | string[] | number | undefined> | Iterable<[string, string]>;

type ErrnoException = Error & { code?: string };
type ErrorConstructorFn = abstract new (...args: unknown[]) => unknown;
type CaptureStackTraceFn = (target: Error, ctor?: ErrorConstructorFn) => void;

const HTTP_ERROR_BODY_MAX_BYTES = 2048;

const RETRYABLE_ERRNO_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
]);

/** Build error from HTTP response context */
export function fromHttpResponse(params: HttpResponseErrorParams): BaseError {
    const { status, body, headers, url, method, exchange } = params;
    const normalizedHeaders = normalizeHeaders(headers);
    const requestId =
        params.requestId ?? normalizedHeaders?.['x-request-id'] ?? normalizedHeaders?.['x-correlation-id'];
    const retryAfterMs = extractRetryAfter(normalizedHeaders);

    const details: Record<string, unknown> = { status };

    if (url) details.url = url;
    if (method) details.method = method;

    if (body !== undefined) {
        const { value, truncated } = buildHttpErrorBody(body);

        details.body = value;

        if (truncated) {
            details.body_truncated = true;
        }
    }

    if (normalizedHeaders) details.headers = normalizedHeaders;
    if (retryAfterMs !== undefined) details.retryAfterMs = retryAfterMs;

    if (status === 401 || status === 403) {
        return AuthError.badCredentials('Unauthorized', {
            httpStatus: status,
            exchange,
            requestId,
            details,
        });
    }

    if (status === 408) {
        return new TimeoutError('Request timeout', {
            httpStatus: status,
            exchange,
            requestId,
            details,
        });
    }

    if (status === 429) {
        return new RateLimitError('Too many requests', {
            httpStatus: status,
            exchange,
            requestId,
            details,
            retryAfterMs,
        });
    }

    if (status === 409 || status === 422) {
        return new OrderRejectedError('Order rejected by exchange', {
            httpStatus: status,
            exchange,
            requestId,
            details,
        });
    }

    if (status >= 400 && status < 500) {
        return new ValidationError('Request validation failed', {
            httpStatus: status,
            exchange,
            requestId,
            details,
        });
    }

    if (status >= 500 && status < 600) {
        return new ExchangeDownError('Exchange service error', {
            httpStatus: status,
            exchange,
            requestId,
            details,
            retryAfterMs,
        });
    }

    return new BaseError({
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${status}`,
        httpStatus: status,
        exchange,
        requestId,
        details,
        retryAfterMs,
    });
}

/** Build error from low-level fetch/network error */
export function fromFetchError(err: unknown, extra: ErrorOverrides = {}): BaseError {
    if (err instanceof BaseError) {
        return err;
    }

    const { message: overrideMessage, cause: overrideCause, ...context } = extra;
    const cause = overrideCause ?? err;
    const baseMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Network error';
    const message = overrideMessage ?? baseMessage;

    if (isAbortError(err)) {
        return new TimeoutError(message || 'Aborted', { ...context, cause });
    }

    if (err instanceof Error && RETRYABLE_ERRNO_CODES.has((err as ErrnoException).code ?? '')) {
        return new NetworkError(message, { ...context, cause });
    }

    return new NetworkError(message, { ...context, cause });
}

/** Build error from WS close event */
export function fromWsClose(params: WsCloseParams): BaseError {
    const { code, reason, exchange } = params;
    const details = { code, reason } satisfies Record<string, unknown>;

    if (code === 1000) {
        // Normal closure as defined by the WebSocket spec. Treat as transient network event.
        return new NetworkError('WebSocket closed', { details, exchange });
    }

    if (code === 1006 || code === 1011) {
        // 1006: abnormal close, 1011: server error — both signal exchange-side issues.
        return new ExchangeDownError('WebSocket abnormal closure', { details, exchange });
    }

    if (code === 1013) {
        // 1013: try again later — exchanges use this for rate limiting/backpressure.
        return new RateLimitError('WebSocket rate limited', { details, exchange });
    }

    return new NetworkError('WebSocket closed unexpectedly', { details, exchange });
}

/** Wrap unknown error into BaseError with specific code */
export function wrap(err: unknown, code?: ErrorCode, overrides: ErrorOverrides = {}): BaseError {
    if (err instanceof BaseError) {
        if (!code && !hasOverrides(overrides)) {
            return err;
        }

        const {
            message: overrideMessage,
            cause: overrideCause,
            details: extraDetails,
            httpStatus,
            retryAfterMs,
            exchange,
            requestId,
        } = overrides;
        const mergedDetails = mergeDetails(err.details, extraDetails);

        return new BaseError({
            code: code ?? err.category,
            message: overrideMessage ?? err.message,
            cause: overrideCause ?? err,
            details: mergedDetails,
            httpStatus: httpStatus ?? err.httpStatus,
            retryAfterMs: retryAfterMs ?? err.retryAfterMs,
            exchange: exchange ?? err.exchange,
            requestId: requestId ?? err.requestId,
        });
    }

    const { message, cause, details, httpStatus, retryAfterMs, exchange, requestId } = overrides;
    const fallbackMessage = message ?? coerceUnknownErrorMessage(err);

    return new BaseError({
        code: code ?? 'UNKNOWN_ERROR',
        message: fallbackMessage,
        cause: cause ?? err,
        details,
        httpStatus,
        retryAfterMs,
        exchange,
        requestId,
    });
}

function hasOverrides(overrides: ErrorOverrides): boolean {
    return Object.values(overrides).some(value => value !== undefined);
}

function mergeDetails(
    existing: Record<string, unknown> | undefined,
    extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!existing && !extra) {
        return undefined;
    }

    return { ...(existing ?? {}), ...(extra ?? {}) };
}

function normalizeHeaders(headers?: HeadersLike): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }

    const normalized: Record<string, string> = {};

    if (isRecord(headers)) {
        for (const [key, value] of Object.entries(headers)) {
            if (value === undefined) continue;

            if (Array.isArray(value)) {
                normalized[key.toLowerCase()] = value.map(v => String(v)).join(', ');
            } else {
                normalized[key.toLowerCase()] = String(value);
            }
        }

        return normalized;
    }

    for (const entry of headers) {
        const [key, value] = entry;

        normalized[String(key).toLowerCase()] = String(value);
    }

    return normalized;
}

function extractRetryAfter(headers?: Record<string, string>): number | undefined {
    if (!headers) {
        return undefined;
    }

    const direct = parseRetryAfterHeader(headers['retry-after']);

    if (direct !== undefined) {
        return direct;
    }

    const directMs = parseRetryAfterMilliseconds(headers['retry-after-ms'] ?? headers['x-retry-after-ms']);

    if (directMs !== undefined) {
        return directMs;
    }

    const reset = parseRateLimitReset(headers['x-rate-limit-reset']);

    if (reset !== undefined) {
        return reset;
    }

    return undefined;
}

function buildHttpErrorBody(body: unknown): { value: unknown; truncated: boolean } {
    const sanitized = safeSerializeValue(body);

    if (shouldLogFullHttpErrorBody()) {
        return { value: sanitized, truncated: false };
    }

    const serialized = stringifyHttpErrorBody(sanitized);
    const { value, truncated } = truncateStringByBytes(serialized, HTTP_ERROR_BODY_MAX_BYTES);

    return { value, truncated };
}

function shouldLogFullHttpErrorBody(): boolean {
    return process.env.EH_LOG_HTTP_ERROR_BODY === '1';
}

function stringifyHttpErrorBody(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return '';
    }

    try {
        const json = JSON.stringify(value);

        return json ?? String(value);
    } catch {
        return String(value);
    }
}

function truncateStringByBytes(value: string, limit: number): { value: string; truncated: boolean } {
    const buffer = Buffer.from(value);

    if (buffer.byteLength <= limit) {
        return { value, truncated: false };
    }

    const truncated = buffer.subarray(0, limit).toString();

    return { value: truncated, truncated: true };
}

function parseRetryAfterHeader(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
        return numeric * 1000;
    }

    const date = Date.parse(value);

    if (!Number.isNaN(date)) {
        const diff = date - Date.now();

        return diff > 0 ? diff : 0;
    }

    return undefined;
}

function parseRetryAfterMilliseconds(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
    }

    return undefined;
}

function parseRateLimitReset(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return undefined;
    }

    const now = Date.now();

    if (numeric > 1e12) {
        const diff = numeric - now;

        return diff > 0 ? diff : 0;
    }

    if (numeric > 1e9) {
        const diff = numeric * 1000 - now;

        return diff > 0 ? diff : 0;
    }

    if (numeric >= 0) {
        return numeric * 1000;
    }

    return undefined;
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    const seen = new WeakSet<object>();
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
        result[key] = safeSerializeValue(value, seen);
    }

    return result;
}

function formatCause(cause: unknown): string | undefined {
    if (cause === undefined || cause === null) {
        return undefined;
    }

    if (cause instanceof BaseError) {
        return cause.message;
    }

    if (cause instanceof Error) {
        return cause.message;
    }

    if (typeof cause === 'string') {
        return cause;
    }

    if (typeof cause === 'number' || typeof cause === 'boolean' || typeof cause === 'bigint') {
        return String(cause);
    }

    try {
        const serialized = safeSerializeValue(cause);

        return typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
    } catch {
        return '[Unserializable cause]';
    }
}

function safeSerializeValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === undefined || value === null) {
        return value;
    }

    const type = typeof value;

    if (type === 'string' || type === 'number' || type === 'boolean') {
        return value;
    }

    if (type === 'bigint' || type === 'symbol' || type === 'function') {
        return String(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof URL !== 'undefined' && value instanceof URL) {
        return value.toString();
    }

    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        return { type: 'ArrayBuffer', byteLength: value.byteLength };
    }

    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
        return { type: value.constructor.name, byteLength: value.byteLength };
    }

    if (value instanceof Error) {
        return {
            type: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (value instanceof Map) {
        if (seen.has(value)) {
            return '[Circular]';
        }

        seen.add(value);

        try {
            const entries = Array.from(value.entries()).map(([k, v]) => [
                safeSerializeValue(k, seen),
                safeSerializeValue(v, seen),
            ]);

            return { type: 'Map', entries };
        } catch {
            return { type: 'Map', entries: '[Unserializable]' };
        } finally {
            seen.delete(value);
        }
    }

    if (value instanceof Set) {
        if (seen.has(value)) {
            return '[Circular]';
        }

        seen.add(value);

        try {
            const entries = Array.from(value.values()).map(v => safeSerializeValue(v, seen));

            return { type: 'Set', values: entries };
        } catch {
            return { type: 'Set', values: '[Unserializable]' };
        } finally {
            seen.delete(value);
        }
    }

    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return '[Circular]';
        }

        seen.add(value);

        try {
            return value.map(item => safeSerializeValue(item, seen));
        } catch {
            return '[Unserializable array]';
        } finally {
            seen.delete(value);
        }
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;

        if (seen.has(obj)) {
            return '[Circular]';
        }

        seen.add(obj);

        try {
            const result: Record<string, unknown> = {};

            for (const [key, val] of Object.entries(obj)) {
                result[key] = safeSerializeValue(val, seen);
            }

            return result;
        } catch {
            return '[Unserializable object]';
        } finally {
            seen.delete(obj);
        }
    }

    return String(value);
}

function coerceUnknownErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    if (typeof err === 'string') {
        return err;
    }

    if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
        return String(err);
    }

    return 'Unknown error';
}

function isAbortError(err: unknown): err is Error {
    if (!(err instanceof Error)) {
        return false;
    }

    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return true;
    }

    if ((err as ErrnoException).code === 'ABORT_ERR' || (err as ErrnoException).code === 'ERR_CANCELED') {
        return true;
    }

    return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function';
}
