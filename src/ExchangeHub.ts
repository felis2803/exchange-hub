import { Cores } from './core/index.js';
import { createEntities } from './entities/index.js';

import type { BaseCore } from './core/BaseCore.js';
import type { ExchangeName, Settings } from './types.js';

export class ExchangeHub<ExName extends ExchangeName> {
  #entities = createEntities(this);
  #core: BaseCore<ExName>;
  #isTest: boolean;

  constructor(exchangeName: ExName, settings: Settings = {}) {
    const { isTest } = settings;

    this.#core = new Cores[exchangeName](this, settings);
    this.#isTest = isTest || false;
  }

  get Core() {
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
