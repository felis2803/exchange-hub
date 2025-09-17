import {
  BaseError,
  NetworkError,
  RateLimitError,
  ExchangeDownError,
  fromWsClose,
  fromHttpResponse,
  wrap,
} from '../src/infra/errors.js';

describe('errors (smoke)', () => {
  test('hierarchy and toJSON', () => {
    const err = new NetworkError('net fail', { details: { a: 1 } });
    expect(err).toBeInstanceOf(BaseError);
    const json = err.toJSON();
    expect(json.code).toBe('NETWORK_ERROR');
    expect(json.message).toContain('net fail');
    expect(json.details).toEqual({ a: 1 });
  });

  test('fromWsClose mapping', () => {
    expect(fromWsClose({ code: 1000 }).code).toBe('NETWORK_ERROR');
    expect(fromWsClose({ code: 1006 }).code).toBe('EXCHANGE_DOWN');
    expect(fromWsClose({ code: 1011 }).code).toBe('EXCHANGE_DOWN');
  });

  test('fromHttpResponse basic mapping', () => {
    const e429 = fromHttpResponse({ status: 429, url: '/x', method: 'GET', retryAfterMs: 2000 });
    expect(e429).toBeInstanceOf(RateLimitError);
    const e503 = fromHttpResponse({ status: 503, url: '/x', method: 'GET' });
    expect(e503).toBeInstanceOf(ExchangeDownError);
  });

  test('wrap unknown', () => {
    const e = wrap('boom');
    expect(e).toBeInstanceOf(BaseError);
    expect(e.code).toBe('UNKNOWN_ERROR');
  });
});
