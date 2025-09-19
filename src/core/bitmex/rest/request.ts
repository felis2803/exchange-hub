import { AuthError, BaseError, fromFetchError, fromHttpResponse } from '../../../infra/errors.js';
import { BITMEX_REST_DEFAULT_TIMEOUT_MS, BITMEX_REST_HOSTS } from '../constants.js';
import { sign } from './sign.js';

import type { BitMexInstrument } from '../types.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestInitEx {
  qs?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  auth?: boolean;
}

export interface BitmexRestClientOptions {
  isTest?: boolean;
  apiKey?: string;
  apiSecret?: string;
  defaultTimeoutMs?: number;
}

export class BitmexRestClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly defaultTimeoutMs: number;

  constructor(opts: BitmexRestClientOptions = {}) {
    this.baseUrl = opts.isTest ? BITMEX_REST_HOSTS.testnet : BITMEX_REST_HOSTS.mainnet;
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? BITMEX_REST_DEFAULT_TIMEOUT_MS;
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

      const expires = Math.floor(Date.now() / 1000) + 60;
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
      const parsed = text ? safeJsonParse(text) : undefined;
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
