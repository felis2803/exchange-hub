import { Cores } from './cores';
import { createEntities } from './entities';

import type { BaseCore } from './cores/BaseCore';
import type { ExchangeName, Settings } from './types';

export class ExchangeHub<ExName extends ExchangeName> {
    #entities = createEntities(this);
    #core: BaseCore<ExName>;
    #isTest: boolean;

    constructor(exchangeName: ExName, settings: Settings = {}) {
        const { isTest } = settings;

        this.#core = new Cores[exchangeName](this, settings);
        this.#isTest = isTest || false;
    }

    get Core(): BaseCore {
        return this.#core;
    }

    get entities() {
        return this.#entities;
    }

    get isTest(): boolean {
        return this.#isTest;
    }

    get instruments() {
        return this.#core.instruments;
    }

    async connect() {
        return this.#core.connect();
    }

    async disconnect() {
        return this.#core.disconnect();
    }
}
