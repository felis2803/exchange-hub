import { mapBitmexOrderStatus } from '../../../src/core/bitmex/mappers/order';
import { OrderStatus } from '../../../src/domain/order';
import type { BitMexExecType, BitMexOrderStatus } from '../../../src/core/bitmex/types';

describe('BitMEX order status mapping', () => {
    type MappingCase = {
        title: string;
        input: {
            ordStatus?: BitMexOrderStatus | undefined;
            execType?: BitMexExecType | undefined;
            leavesQty?: number;
            cumQty?: number;
        };
        expected: OrderStatus;
    };

    const baseCases: MappingCase[] = [
        {
            title: 'acknowledges new order',
            input: { ordStatus: 'New', execType: 'New', leavesQty: 100, cumQty: 0 },
            expected: OrderStatus.Placed,
        },
        {
            title: 'partial fill from trade leaves open quantity',
            input: { ordStatus: 'PartiallyFilled', execType: 'Trade', leavesQty: 10, cumQty: 5 },
            expected: OrderStatus.PartiallyFilled,
        },
        {
            title: 'trade with zero leaves marks as filled',
            input: { ordStatus: 'Filled', execType: 'Trade', leavesQty: 0, cumQty: 10 },
            expected: OrderStatus.Filled,
        },
        {
            title: 'explicit cancel',
            input: { ordStatus: 'Canceled', execType: 'Canceled', leavesQty: 0, cumQty: 0 },
            expected: OrderStatus.Canceled,
        },
        {
            title: 'rejection stays rejected',
            input: { ordStatus: 'Rejected', execType: 'New', leavesQty: 0, cumQty: 0 },
            expected: OrderStatus.Rejected,
        },
        {
            title: 'expiry event',
            input: { ordStatus: 'Expired', execType: 'Expired', leavesQty: 0, cumQty: 0 },
            expected: OrderStatus.Expired,
        },
        {
            title: 'triggered stop treated as placed',
            input: { ordStatus: 'Triggered', execType: 'New', leavesQty: 50, cumQty: 0 },
            expected: OrderStatus.Placed,
        },
        {
            title: 'trade without ordStatus uses quantities',
            input: { ordStatus: undefined, execType: 'Trade', leavesQty: 5, cumQty: 2 },
            expected: OrderStatus.PartiallyFilled,
        },
        {
            title: 'trade overrides cancel to filled when leaves zero',
            input: { ordStatus: 'Canceled', execType: 'Trade', leavesQty: 0, cumQty: 8 },
            expected: OrderStatus.Filled,
        },
    ] as const;

    test.each(baseCases)('%s', ({ input, expected }) => {
        expect(
            mapBitmexOrderStatus({
                ...input,
                previousStatus: null,
            }),
        ).toBe(expected);
    });

    test('returns previous status when no signals provided', () => {
        expect(
            mapBitmexOrderStatus({
                ordStatus: undefined,
                execType: undefined,
                previousStatus: OrderStatus.PartiallyFilled,
            }),
        ).toBe(OrderStatus.PartiallyFilled);
    });

    test('does not downgrade filled to placed', () => {
        expect(
            mapBitmexOrderStatus({
                ordStatus: 'New',
                execType: 'New',
                leavesQty: 20,
                cumQty: 0,
                previousStatus: OrderStatus.Filled,
            }),
        ).toBe(OrderStatus.Filled);
    });

    test('does not downgrade canceled to placed', () => {
        expect(
            mapBitmexOrderStatus({
                ordStatus: 'New',
                execType: 'New',
                leavesQty: 50,
                cumQty: 0,
                previousStatus: OrderStatus.Canceled,
            }),
        ).toBe(OrderStatus.Canceled);
    });

    test('upgrades canceled to filled when trade indicates completion', () => {
        expect(
            mapBitmexOrderStatus({
                ordStatus: 'Canceled',
                execType: 'Trade',
                leavesQty: 0,
                cumQty: 10,
                previousStatus: OrderStatus.Canceled,
            }),
        ).toBe(OrderStatus.Filled);
    });
});
