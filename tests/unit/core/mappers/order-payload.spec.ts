import { mapPreparedOrderToCreatePayload } from '../../../../src/core/bitmex/mappers/order';
import { ValidationError } from '../../../../src/infra/errors';
import type { PreparedPlaceInput } from '../../../../src/infra/validation';

function createPreparedInput(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 10,
        type: 'Limit',
        price: 50_000,
        stopPrice: null,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: 'GoodTillCancel',
            clOrdId: 'cli-unit-1',
        },
    };

    return {
        ...base,
        ...overrides,
        options: { ...base.options, ...overrides.options },
    };
}

describe('mapPreparedOrderToCreatePayload', () => {
    test('throws ValidationError when market order is marked as post-only', () => {
        const input = createPreparedInput({
            type: 'Market',
            price: null,
            options: { postOnly: true },
        });

        expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
            new ValidationError('postOnly is allowed for limit orders only'),
        );
    });

    test.each([
        ['GoodTillCancel', 'GoodTillCancel'],
        ['ImmediateOrCancel', 'ImmediateOrCancel'],
        ['FillOrKill', 'FillOrKill'],
        ['GTC', 'GoodTillCancel'],
        ['IOC', 'ImmediateOrCancel'],
        ['FOK', 'FillOrKill'],
        ['gtc', 'GoodTillCancel'],
        ['ioc', 'ImmediateOrCancel'],
        ['fok', 'FillOrKill'],
        ['  GTC  ', 'GoodTillCancel'],
    ])('normalizes timeInForce %s to %s', (timeInForce, expected) => {
        const input = createPreparedInput({ options: { timeInForce } });

        const payload = mapPreparedOrderToCreatePayload(input);

        expect(payload.timeInForce).toBe(expected);
    });

    test('throws ValidationError on unsupported timeInForce', () => {
        const input = createPreparedInput({ options: { timeInForce: 'Day' } });

        expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
            new ValidationError('unsupported timeInForce'),
        );
    });

    test('maps stop orders to stop ordType with stopPx only', () => {
        const input = createPreparedInput({
            type: 'Stop',
            price: null,
            stopPrice: 50_500,
        });

        const payload = mapPreparedOrderToCreatePayload(input);

        expect(payload).toMatchObject({ ordType: 'Stop', stopPx: 50_500 });
        expect(payload).not.toHaveProperty('price');
    });

    test('maps stop-limit orders with both price and stopPx', () => {
        const input = createPreparedInput({
            type: 'StopLimit',
            price: 50_450,
            stopPrice: 50_500,
        });

        const payload = mapPreparedOrderToCreatePayload(input);

        expect(payload).toMatchObject({ ordType: 'StopLimit', price: 50_450, stopPx: 50_500 });
    });

    test('throws when stop order is missing stop price', () => {
        const input = createPreparedInput({ type: 'Stop', price: null, stopPrice: null });

        expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
            new ValidationError('stop order requires stop price'),
        );
    });

    test('throws when stop-limit payload misses limit price', () => {
        const input = createPreparedInput({ type: 'StopLimit', price: null, stopPrice: 50_400 });

        expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
            new ValidationError('stop-limit order requires limit price'),
        );
    });

    test('throws when stop-limit payload misses stop price', () => {
        const input = createPreparedInput({ type: 'StopLimit', price: 50_400, stopPrice: null });

        expect(() => mapPreparedOrderToCreatePayload(input)).toThrowError(
            new ValidationError('stop order requires stop price'),
        );
    });
});
