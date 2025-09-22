import { genClOrdID } from '../../../../src/infra/ids';
import { Instrument } from '../../../../src/domain/instrument';

let seedCounter = 0;

function uniqueSeed(): string {
    seedCounter += 1;

    return `unit-seed-${seedCounter}`;
}

function extractCounter(id: string): number {
    const lastSegment = id.split('-').pop() ?? '';
    const counterPart = lastSegment.slice(0, 4);

    return parseInt(counterPart, 36);
}

describe('genClOrdID', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('produces sequential identifiers for the same seed', () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

        const seed = uniqueSeed();

        const first = genClOrdID(seed);
        const second = genClOrdID(seed);
        const third = genClOrdID(seed);

        expect(first).not.toBe(second);
        expect(second).not.toBe(third);
        expect(extractCounter(second)).toBe(extractCounter(first) + 1);
        expect(extractCounter(third)).toBe(extractCounter(second) + 1);
    });

    test('normalizes provided seed', () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_100);

        const generated = genClOrdID('  My Bot 01  ');

        expect(generated.startsWith('mybot01-')).toBe(true);

        const fallback = genClOrdID('   ');

        expect(fallback.startsWith('eh-')).toBe(true);
    });
});

describe('Instrument clOrdID handling', () => {
    function createInstrument(): Instrument {
        return new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' }, { tradeBufferSize: 10 });
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('preserves user-supplied clOrdID', () => {
        const instrument = createInstrument();

        instrument.orderBook.bestBid = { price: 100, size: 10 };
        instrument.orderBook.bestAsk = { price: 101, size: 10 };

        const result = instrument.buy(5, 100, { clOrdID: '  client-42  ' });

        expect(result.options.clOrdId).toBe('client-42');
        expect(result.type).toBe('Limit');
    });

    test('generates clOrdID when not provided', () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_200);

        const instrument = createInstrument();

        const result = instrument.sell(2);

        expect(result.options.clOrdId).toMatch(/^eh-/);
        expect(result.type).toBe('Market');
    });
});
