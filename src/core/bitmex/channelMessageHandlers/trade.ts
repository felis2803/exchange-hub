import { handleTradeMessage } from '../channels/trade';
import type { BitMex } from '../index';
import type { BitMexChannelMessage } from '../types';

type TradeMessage = BitMexChannelMessage<'trade'>;

function forward(core: BitMex, action: TradeMessage['action'], data: TradeMessage['data']): void {
    handleTradeMessage(core, { table: 'trade', action, data });
}

export const trade = {
    partial(core: BitMex, data: TradeMessage['data']) {
        forward(core, 'partial', data);
    },

    insert(core: BitMex, data: TradeMessage['data']) {
        forward(core, 'insert', data);
    },

    update(core: BitMex, data: TradeMessage['data']) {
        forward(core, 'update', data);
    },

    delete(core: BitMex, data: TradeMessage['data']) {
        forward(core, 'delete', data);
    },
};
