import { jest } from '@jest/globals';

import { BitmexRestClient } from '../../src/cores/bitmex/rest/request.js';
import { sign } from '../../src/cores/bitmex/rest/sign.js';
import { AuthError, ExchangeDownError } from '../../src/infra/errors.js';

describe('BitmexRestClient.request()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('GET builds url with query string and returns JSON payload', async () => {
    const payload = [{ symbol: 'XBTUSD' }];
    const mockFetch = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://testnet.bitmex.com/api/v1/instrument/active?count=1');
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    const data = await client.request('GET', '/api/v1/instrument/active', { qs: { count: 1 } });

    expect(data).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ accept: 'application/json' });
  });

  test('getActiveInstruments() uses public endpoint', async () => {
    const payload = [{ symbol: 'ETHUSD' }];
    const mockFetch = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    const instruments = await client.getActiveInstruments();

    expect(instruments).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://testnet.bitmex.com/api/v1/instrument/active',
      expect.any(Object),
    );
  });

  test('adds auth headers when credentials provided and auth enabled', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_600_000_000_000);
    const mockFetch = jest.fn(async () => new Response('[]', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({
      apiKey: 'key',
      apiSecret: 'secret',
      isTest: false,
    });

    await client.request('POST', '/api/v1/order', {
      auth: true,
      body: { symbol: 'XBTUSD', orderQty: 1 },
    });

    const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['api-key']).toBe('key');
    expect(headers['api-expires']).toBe(String(Math.floor(1_600_000_000_000 / 1000) + 60));
    const expectedSignature = sign(
      'POST',
      '/api/v1/order',
      Math.floor(1_600_000_000_000 / 1000) + 60,
      JSON.stringify({ symbol: 'XBTUSD', orderQty: 1 }),
      'secret',
    );
    expect(headers['api-signature']).toBe(expectedSignature);
    nowSpy.mockRestore();
  });

  test('throws AuthError when auth requested without credentials', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    await expect(
      client.request('GET', '/api/v1/user/margin', { auth: true }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('maps 401 responses to AuthError', async () => {
    const mockFetch = jest.fn(async () => new Response('Unauthorized', { status: 401 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ apiKey: 'k', apiSecret: 's', isTest: true });
    await expect(client.request('GET', '/api/v1/user/margin', { auth: true })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  test('maps 429 to RateLimitError with retryAfterMs', async () => {
    const mockFetch = jest.fn(async () =>
      new Response('{"error":"Too Many Requests"}', {
        status: 429,
        headers: { 'Retry-After': '2' },
      }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    await expect(client.request('GET', '/api/v1/instrument/active')).rejects.toMatchObject({
      retryAfterMs: 2000,
      code: 'RATE_LIMIT',
    });
  });

  test('maps Retry-After date header to retryAfterMs', async () => {
    const now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const retryDate = new Date(now + 5_000).toUTCString();
    const mockFetch = jest.fn(async () =>
      new Response('Too many', {
        status: 429,
        headers: { 'Retry-After': retryDate },
      }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    await expect(client.request('GET', '/api/v1/instrument/active')).rejects.toHaveProperty('retryAfterMs', 5000);
    nowSpy.mockRestore();
  });

  test('maps 5xx to ExchangeDownError', async () => {
    const mockFetch = jest.fn(async () => new Response('Server down', { status: 503 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new BitmexRestClient({ isTest: true });
    await expect(client.request('GET', '/api/v1/instrument/active')).rejects.toBeInstanceOf(
      ExchangeDownError,
    );
  });
});
