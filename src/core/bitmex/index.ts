import type { Settings } from '../../types';
import type { ExchangeHub } from '../../ExchangeHub';
import { BaseCore } from '../BaseCore';

export class BitMex extends BaseCore<'BitMex'> {
    constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
        super(shell, settings);
    }
}
