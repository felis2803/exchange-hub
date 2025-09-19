import { handleOrderMessage } from '../channels/order.js';

import type { BitMex } from '../index.js';
import type { BitMexChannelMessage } from '../types.js';

type OrderMessage = BitMexChannelMessage<'order'>;

function forward(core: BitMex, action: OrderMessage['action'], data: OrderMessage['data']): void {
  handleOrderMessage(core, { table: 'order', action, data });
}

export const order = {
  partial(core: BitMex, data: OrderMessage['data']) {
    forward(core, 'partial', data);
  },

  insert(core: BitMex, data: OrderMessage['data']) {
    forward(core, 'insert', data);
  },

  update(core: BitMex, data: OrderMessage['data']) {
    forward(core, 'update', data);
  },

  delete(core: BitMex, data: OrderMessage['data']) {
    forward(core, 'delete', data);
  },
};
