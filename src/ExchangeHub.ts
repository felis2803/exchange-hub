import { Cores } from './core/index.js';
import { createEntities } from './entities/index.js';
import { OrdersRegistry } from './core/exchange-hub.js';

import type { BaseCore } from './core/BaseCore.js';
import type { ExchangeName, Settings } from './types.js';

export class ExchangeHub<ExName extends ExchangeName> {
  #entities = createEntities(this);
  #core: BaseCore<ExName>;
  #isTest: boolean;
  #orders = new OrdersRegistry();

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

  get orders(): OrdersRegistry {
    return this.#orders;
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
