import { handleTradeInsert, handleTradeMessage, handleTradePartial } from '../channels/trade.js';

import type { BitMex } from '../index.js';
import type { BitMexChannelMessage, BitMexTrade } from '../types.js';

function forward(
  core: BitMex,
  action: BitMexChannelMessage<'trade'>['action'],
  data: BitMexTrade[],
): void {
  handleTradeMessage(core, { table: 'trade', action, data });
}

export const trade = {
  partial(core: BitMex, data: BitMexTrade[]) {
    handleTradePartial(core, data);
  },

  insert(core: BitMex, data: BitMexTrade[]) {
    handleTradeInsert(core, data);
  },

  update(core: BitMex, data: BitMexTrade[]) {
    forward(core, 'update', data);
  },

  delete(core: BitMex, data: BitMexTrade[]) {
    forward(core, 'delete', data);
  },
};
