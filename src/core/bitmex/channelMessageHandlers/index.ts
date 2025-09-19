import { instrument } from './instrument.js';
import { trade } from './trade.js';
import { liquidation } from './liquidation.js';
import { orderBookL2 } from './orderBookL2.js';
import { settlement } from './settlement.js';
import { execution } from './execution.js';
import { order } from './order.js';
import { margin } from './margin.js';
import { position } from './position.js';
import { transact } from './transact.js';
import { wallet } from './wallet.js';

import type { BitMex } from '../index.js';
import type {
  BitMexChannel,
  BitMexChannelMessageAction,
  BitMexChannelMessageMap,
} from '../types.js';

export const channelMessageHandlers: {
  [Channel in BitMexChannel]: {
    [Action in BitMexChannelMessageAction]: (
      core: BitMex,
      data: BitMexChannelMessageMap[Channel][],
    ) => void;
  };
} = {
  instrument,
  trade,
  liquidation,
  orderBookL2,
  settlement,
  execution,
  order,
  margin,
  position,
  transact,
  wallet,
};
