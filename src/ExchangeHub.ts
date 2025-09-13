import { Cores } from './cores';
import { createEntities, type Entities, type Instrument } from './entities';

import type { BaseCore } from './cores/BaseCore';
import type { ExchangeName, Settings } from './types';

export class ExchangeHub<ExName extends ExchangeName> {
    #core: BaseCore;
    #isTest: boolean;
    #instruments: Instrument[] = [];
    readonly entities: Entities;

    constructor(exchangeName: ExName, settings: Settings = {}) {
        const { isTest } = settings;

        this.entities = createEntities(this);
        this.#core = new Cores[exchangeName](this, settings);
        this.#isTest = isTest || false;
    }

    get Core(): BaseCore {
        return this.#core;
    }

    get isTest(): boolean {
        return this.#isTest;
    }

    get instruments(): Instrument[] {
        return this.#instruments;
    }

    async connect() {
        await this.#core.connect();
        this.#instruments = this.#core.instruments;
    }

    async disconnect() {
        this.#instruments = [];
        await this.#core.disconnect();
    }
}
