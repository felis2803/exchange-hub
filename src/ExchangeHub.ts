import { Cores } from './cores';

import type { Instrument } from './entities/Instrument';
import type { BaseCore } from './cores/BaseCore';
import type { ExchangeName, Settings } from './types';

export class ExchangeHub<ExName extends ExchangeName> {
    #core: BaseCore;
    #isTest: boolean;
    #instruments: Instrument[] = [];

    constructor(exchangeName: ExName, settings: Settings = {}) {
        const { isTest } = settings;

        this.#core = new Cores[exchangeName](this, settings);
        this.#isTest = isTest || false;
    }

    get Core(): BaseCore {
        return this.#core;
    }

    get isTest(): boolean {
        return this.#isTest;
    }

    get instruments() {
        return this.#instruments;
    }

    async connect() {
        await this.#core.connect();

        this.#instruments = await this.#core.getInstruments();

        for (const instrument of this.#instruments) {
            instrument.orders = await this.#core.getOrders(instrument);
        }
    }

    async disconnect() {
        this.#instruments = [];
        await this.#core.disconnect();
    }
}
