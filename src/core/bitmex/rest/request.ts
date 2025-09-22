import { sign } from './sign';

import { AuthError, BaseError, fromFetchError, fromHttpResponse } from '../../../infra/errors';
import { createLogger } from '../../../infra/logger';
import { BITMEX_REST_DEFAULT_TIMEOUT_MS, BITMEX_REST_HOSTS } from '../constants';
import type { BitMexInstrument } from '../types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestInitEx {
    qs?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    timeoutMs?: number;
    auth?: boolean;
}

const DEFAULT_EXPIRES_SKEW_SEC = 60;

const log = createLogger('bitmex:rest:request');

export interface BitmexRestClientOptions {
    isTest?: boolean;
    apiKey?: string;
    apiSecret?: string;
    defaultTimeoutMs?: number;
    apiExpiresSkewSec?: number;
}

export class BitmexRestClient {
    readonly baseUrl: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly defaultTimeoutMs: number;
    readonly apiExpiresSkewSec: number;

    constructor(opts: BitmexRestClientOptions = {}) {
        this.baseUrl = opts.isTest ? BITMEX_REST_HOSTS.testnet : BITMEX_REST_HOSTS.mainnet;
        this.apiKey = opts.apiKey;
        this.apiSecret = opts.apiSecret;
        this.defaultTimeoutMs = opts.defaultTimeoutMs ?? BITMEX_REST_DEFAULT_TIMEOUT_MS;
        this.apiExpiresSkewSec = resolveExpiresSkewSec(opts.apiExpiresSkewSec);
    }

    async request<T>(method: HttpMethod, path: string, init: RequestInitEx = {}): Promise<T> {
        const url = new URL(path, this.baseUrl);

        if (init.qs) {
            for (const [key, value] of Object.entries(init.qs)) {
                if (value === undefined) continue;
                url.searchParams.set(key, String(value));
            }
        }

        const pathWithQuery = `${url.pathname}${url.search}`;

        const hasBody = init.body !== undefined && init.body !== null;
        let payloadBody = '';
        let requestBody: string | undefined;

        if (hasBody) {
            payloadBody = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
            requestBody = payloadBody;
        }

        const headers: Record<string, string> = { accept: 'application/json' };

        if (hasBody) {
            headers['content-type'] = 'application/json';
        }

        const hasCredentials = Boolean(this.apiKey && this.apiSecret);
        const shouldSign = init.auth ?? (hasCredentials && path.startsWith('/api/'));

        if (shouldSign) {
            if (!hasCredentials) {
                throw AuthError.badCredentials('BitMEX API credentials required', { exchange: 'BitMEX' });
            }

            const expires = Math.floor(Date.now() / 1000) + this.apiExpiresSkewSec;
            const signature = sign(method, pathWithQuery, expires, payloadBody, this.apiSecret!);

            headers['api-key'] = this.apiKey!;
            headers['api-expires'] = String(expires);
            headers['api-signature'] = signature;
        }

        const controller = new AbortController();
        const timeoutMs = init.timeoutMs ?? this.defaultTimeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url.toString(), {
                method,
                headers,
                body: requestBody,
                signal: controller.signal,
            });

            const text = await response.text();
            const parsed = text ? safeJsonParse(text, { url: pathWithQuery, method }) : undefined;
            const payload = parsed ?? (text || undefined);

            if (!response.ok) {
                throw fromHttpResponse({
                    status: response.status,
                    body: payload,
                    headers: response.headers,
                    url: pathWithQuery,
                    method,
                    exchange: 'BitMEX',
                });
            }

            return (parsed as T) ?? (undefined as unknown as T);
        } catch (error) {
            if (error instanceof BaseError) {
                throw error;
            }

            throw fromFetchError(error, { exchange: 'BitMEX' });
        } finally {
            clearTimeout(timeout);
        }
    }

    getActiveInstruments(): Promise<BitMexInstrument[]> {
        return this.request('GET', '/api/v1/instrument/active');
    }
}

function safeJsonParse(text: string, context: { url: string; method: HttpMethod }): unknown {
    try {
        return JSON.parse(text);
    } catch {
        log.debug('bitmex response json parse failed', {
            url: context.url,
            method: context.method,
            note: 'falling back to text',
        });

        return undefined;
    }
}

function resolveExpiresSkewSec(optionValue?: number): number {
    const normalizedOption = normalizePositiveInteger(optionValue);

    if (normalizedOption !== undefined) {
        return normalizedOption;
    }

    const envValue = normalizePositiveInteger(process.env.BITMEX_REST_EXPIRES_SKEW_SEC);

    return envValue ?? DEFAULT_EXPIRES_SKEW_SEC;
}

function normalizePositiveInteger(value: unknown): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const numeric = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);

    if (!Number.isFinite(numeric)) {
        return undefined;
    }

    if (numeric <= 0) {
        return undefined;
    }

    return Math.floor(numeric);
}
