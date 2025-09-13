import { BitMexTransport } from './transport';

import { BaseCore } from '../BaseCore';
import type { Settings } from '../../types';
import type { ExchangeHub } from '../../ExchangeHub';

export class BitMex extends BaseCore<'BitMex'> {
    #settings: Settings;
    #transport: BitMexTransport;

    constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
        super(shell, settings);

        this.#settings = settings;
        this.#transport = new BitMexTransport(this, settings.isTest ?? false);
    }

    async connect(): Promise<void> {
        this.#transport.connect(this.#settings.apiKey, this.#settings.apiSec);

        throw 'not implemented';
    }

    async disconnect(): Promise<void> {
        throw 'not implemented';
    }
}
