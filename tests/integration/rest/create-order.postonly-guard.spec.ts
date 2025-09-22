import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub';
import { ValidationError } from '../../../src/infra/errors';
import type { BitMex } from '../../../src/core/bitmex/index';
import type { PreparedPlaceInput } from '../../../src/infra/validation';
import type { FetchRequestInit, FetchRequestInfo } from '../../fetch-types';

const ORIGINAL_FETCH = global.fetch;

function createHub() {
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;

    return { hub, core };
}

function createPreparedLimit(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'sell',
        size: 2,
        type: 'Limit',
        price: 60_000,
        stopPrice: null,
        options: {
            postOnly: true,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'cli-guard-1',
        },
    };

    return {
        ...base,
        ...overrides,
        options: { ...base.options, ...overrides.options },
    };
}

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 5,
        type: 'Market',
        price: null,
        stopPrice: null,
        options: {
            postOnly: true,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'cli-guard-2',
        },
    };

    return {
        ...base,
        ...overrides,
        options: { ...base.options, ...overrides.options },
    };
}

describe('BitMEX REST createOrder – postOnly guard', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('keeps ParticipateDoNotInitiate execInst for limit orders', async () => {
        const mockFetch = jest.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        orderID: 'ord-guard-1',
                        clOrdID: 'cli-guard-1',
                        symbol: 'XBTUSD',
                        side: 'Sell',
                        orderQty: 2,
                        price: 60_000,
                        ordType: 'Limit',
                        ordStatus: 'New',
                        execType: 'New',
                        leavesQty: 2,
                        cumQty: 0,
                        avgPx: 0,
                        timestamp: '2024-01-01T00:00:00.000Z',
                    }),
                    { status: 200 },
                ),
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const { core } = createHub();
        const prepared = createPreparedLimit();

        await core.sell(prepared);

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, init] = mockFetch.mock.calls[0] as [FetchRequestInfo | URL, FetchRequestInit];
        const body = JSON.parse(String(init.body));

        expect(body.execInst).toBe('ParticipateDoNotInitiate');
    });

    test('rejects market orders marked as post-only before hitting REST', async () => {
        const mockFetch = jest.fn();

        global.fetch = mockFetch as unknown as typeof fetch;

        const { core } = createHub();
        const prepared = createPreparedMarket();

        await expect(core.buy(prepared)).rejects.toThrowError(
            new ValidationError('postOnly is allowed for limit orders only'),
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
