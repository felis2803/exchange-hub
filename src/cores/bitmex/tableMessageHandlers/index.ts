import { instrument } from './instrument';

import type { BitMex } from '..';
import type { BitMexChannel, BitMexChannelMessageAction, BitMexChannelMessageMap } from '../types';

export const tableMessageHandlers: {
    [Channel in BitMexChannel]: {
        [Action in BitMexChannelMessageAction]: (core: BitMex, data: BitMexChannelMessageMap[Channel][]) => void;
    };
} = { instrument };
