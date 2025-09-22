import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { BITMEX_CREATE_ORDER_TIMEOUT_MS } from '../../../src/core/bitmex/rest/orders.js';
import { RateLimitError } from '../../../src/infra/errors.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { PreparedPlaceInput } from '../../../src/infra/validation.js';
import type { Logger } from '../../../src/infra/logger.js';
import * as loggerModule from '../../../src/infra/logger.js';

const ORIGINAL_FETCH = global.fetch;

function createMockLogger(): Logger {
    const logger: Logger = {
        level: jest.fn(() => 'info'),
        setLevel: jest.fn(),
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        withContext: jest.fn() as unknown as Logger['withContext'],
        withTags: jest.fn() as unknown as Logger['withTags'],
    } as Logger;

    (logger.withContext as jest.Mock).mockReturnValue(logger);
    (logger.withTags as jest.Mock).mockReturnValue(logger);

    return logger;
}

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 10,
        type: 'Market',
        price: null,
        stopPrice: null,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'cli-retry-1',
        },
    };

    return {
        ...base,
        ...overrides,
        options: { ...base.options, ...overrides.options },
    };
}

function createHub() {
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;

    return { hub, core };
}

function mockBitmexLogger(logger: Logger) {
    const actualCreateLogger = loggerModule.createLogger;

    return jest.spyOn(loggerModule, 'createLogger').mockImplementation((namespace?: string, context?: any) => {
        if (namespace === 'bitmex:core') {
            return logger;
        }

        return actualCreateLogger(namespace, context);
    });
}

describe('BitMEX REST createOrder – retry policy and logging', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('retries once on 5xx and logs attempts', async () => {
        const logger = createMockLogger();
        const createLoggerSpy = mockBitmexLogger(logger);

        const mockFetch = jest
            .fn()
            .mockResolvedValueOnce(new Response('oops', { status: 503 }))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        orderID: 'ord-retry-1',
                        clOrdID: 'cli-retry-1',
                        symbol: 'XBTUSD',
                        side: 'Buy',
                        orderQty: 10,
                        ordType: 'Market',
                        ordStatus: 'New',
                        execType: 'New',
                        leavesQty: 10,
                        cumQty: 0,
                        avgPx: 0,
                        timestamp: '2024-01-01T00:00:00.000Z',
                    }),
                    { status: 200 },
                ),
            );

        global.fetch = mockFetch as unknown as typeof fetch;

        const { core } = createHub();
        const prepared = createPreparedMarket();

        const order = await core.buy(prepared);

        expect(order.getSnapshot().orderId).toBe('ord-retry-1');
        expect(mockFetch).toHaveBeenCalledTimes(2);

        expect(logger.warn).toHaveBeenCalledTimes(1);

        const warnArgs = (logger.warn as jest.Mock).mock.calls[0];
        const warnContext = warnArgs.at(-1);

        expect(warnContext).toMatchObject({
            attempt: 1,
            maxAttempts: 2,
            elapsedMs: expect.any(Number),
            timeoutMs: BITMEX_CREATE_ORDER_TIMEOUT_MS,
            clOrdID: 'cli-retry-1',
            symbol: 'XBTUSD',
            errorName: 'ExchangeDownError',
            httpStatus: 503,
            code: 'EXCHANGE_DOWN',
            willRetry: true,
        });

        expect(logger.info).toHaveBeenCalledTimes(1);

        const infoArgs = (logger.info as jest.Mock).mock.calls[0];
        const infoContext = infoArgs.at(-1);

        expect(infoContext).toMatchObject({
            attempt: 2,
            attemptCount: 2,
            maxAttempts: 2,
            elapsedMs: expect.any(Number),
            latencyMs: expect.any(Number),
            timeoutMs: BITMEX_CREATE_ORDER_TIMEOUT_MS,
            clOrdID: 'cli-retry-1',
            symbol: 'XBTUSD',
        });

        expect(logger.error).not.toHaveBeenCalled();
        createLoggerSpy.mockRestore();
    });

    test('does not retry on 429 and logs error context', async () => {
        const logger = createMockLogger();
        const createLoggerSpy = mockBitmexLogger(logger);

        const mockFetch = jest.fn(
            async () =>
                new Response('Too many requests', {
                    status: 429,
                    headers: { 'Retry-After': '1' },
                }),
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const { core } = createHub();
        const prepared = createPreparedMarket({
            options: { clOrdId: 'cli-rl-1' },
        });

        await expect(core.buy(prepared)).rejects.toBeInstanceOf(RateLimitError);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);

        const errorArgs = (logger.error as jest.Mock).mock.calls[0];
        const errorContext = errorArgs.at(-1);

        expect(errorContext).toMatchObject({
            attempt: 1,
            maxAttempts: 2,
            elapsedMs: expect.any(Number),
            timeoutMs: BITMEX_CREATE_ORDER_TIMEOUT_MS,
            clOrdID: 'cli-rl-1',
            symbol: 'XBTUSD',
            errorName: 'RateLimitError',
            httpStatus: 429,
            code: 'RATE_LIMIT',
            willRetry: false,
        });

        expect(logger.info).not.toHaveBeenCalled();
        createLoggerSpy.mockRestore();
    });
});
