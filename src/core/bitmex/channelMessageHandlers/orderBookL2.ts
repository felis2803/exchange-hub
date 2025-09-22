import { handleOrderBookMessage } from '../channels/orderBookL2';
import type { BitMex } from '../index';
import type { BitMexChannelMessage } from '../types';

type OrderBookMessage = BitMexChannelMessage<'orderBookL2'>;

function forward(core: BitMex, action: OrderBookMessage['action'], data: OrderBookMessage['data']): void {
    handleOrderBookMessage(core, { table: 'orderBookL2', action, data });
}

export const orderBookL2 = {
    partial(core: BitMex, data: OrderBookMessage['data']) {
        forward(core, 'partial', data);
    },

    insert(core: BitMex, data: OrderBookMessage['data']) {
        forward(core, 'insert', data);
    },

    update(core: BitMex, data: OrderBookMessage['data']) {
        forward(core, 'update', data);
    },

    delete(core: BitMex, data: OrderBookMessage['data']) {
        forward(core, 'delete', data);
    },
};
