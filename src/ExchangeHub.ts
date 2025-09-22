import { Cores } from './core/index';
import { createEntities } from './entities/index';

import type { BaseCore } from './core/BaseCore';
import type { ExchangeName, Settings } from './types';

export class ExchangeHub<ExName extends ExchangeName> {
    #entities = createEntities(this);
    #core: BaseCore<ExName>;

    constructor(exchangeName: ExName, settings: Settings = {}) {
        this.#core = new Cores[exchangeName](this, settings);
    }

    get Core() {
        return this.#core;
    }

    get entities() {
        return this.#entities;
    }
}
