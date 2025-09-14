import { instrument } from './instrument';
import { trade } from './trade';
import { funding } from './funding';
import { liquidation } from './liquidation';
import { orderBookL2 } from './orderBookL2';
import { settlement } from './settlement';
import { execution } from './execution';
import { order } from './order';
import { margin } from './margin';
import { position } from './position';
import { transact } from './transact';
import { wallet } from './wallet';

import type { BitMex } from '..';
import type { BitMexChannel, BitMexChannelMessageAction, BitMexChannelMessageMap } from '../types';

export const tableMessageHandlers: {
    [Channel in BitMexChannel]: {
        [Action in BitMexChannelMessageAction]: (core: BitMex, data: BitMexChannelMessageMap[Channel][]) => void;
    };
} = {
    instrument,
    trade,
    funding,
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
