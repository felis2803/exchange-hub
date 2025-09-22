import { Instrument } from '../../../src/domain/instrument.js';
import { ValidationError } from '../../../src/infra/errors.js';

function createInstrument(): Instrument {
    return new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'XBTUSD' });
}

describe('Instrument place preparation', () => {
    test('rejects buy stop orders with trigger below best ask', () => {
        const instrument = createInstrument();

        instrument.orderBook.reset([
            { id: 1, side: 'buy', price: 49_900, size: 10 },
            { id: 2, side: 'sell', price: 50_000, size: 10 },
        ]);

        const attempt = () => instrument.buy(1, 49_950, { stopLimitPrice: 49_940 });

        expect(attempt).toThrow(ValidationError);
        expect(attempt).toThrowErrorMatchingInlineSnapshot('"invalid stop zone"');
    });

    test('rejects sell stop orders with trigger above best bid', () => {
        const instrument = createInstrument();

        instrument.orderBook.reset([
            { id: 1, side: 'buy', price: 49_900, size: 5 },
            { id: 2, side: 'sell', price: 50_000, size: 5 },
        ]);

        const attempt = () => instrument.sell(1, 49_950, { stopLimitPrice: 49_960 });

        expect(attempt).toThrow(ValidationError);
        expect(attempt).toThrowErrorMatchingInlineSnapshot('"invalid stop zone"');
    });

    test('accepts stop-limit orders within valid zone', () => {
        const instrument = createInstrument();

        instrument.orderBook.reset([
            { id: 1, side: 'buy', price: 49_900, size: 5 },
            { id: 2, side: 'sell', price: 50_000, size: 5 },
        ]);

        const prepared = instrument.buy(2, 50_050, { stopLimitPrice: 50_040, clOrdID: 'unit-stop' });

        expect(prepared.type).toBe('StopLimit');
        expect(prepared.stopPrice).toBe(50_050);
        expect(prepared.price).toBe(50_040);
    });

    test('allows stop orders when top of book is unavailable', () => {
        const instrument = createInstrument();

        expect(() => instrument.buy(1, 50_000, { stopLimitPrice: 49_900 })).not.toThrow();
    });
});
