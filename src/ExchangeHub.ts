import { Cores } from './core/index.js';
import { createEntities } from './entities/index.js';
import { PositionsRegistry, type PositionsView } from './domain/position.js';
import { incrementCounter } from './infra/metrics.js';
import { METRICS as PRIVATE_METRICS } from './infra/metrics-private.js';

import type { BaseCore } from './core/BaseCore.js';
import type { ExchangeName, Settings } from './types.js';

export class ExchangeHub<ExName extends ExchangeName> {
  #entities = createEntities(this);
  #core: BaseCore<ExName>;
  #isTest: boolean;
  #positions: PositionsRegistry;
  #positionsView: PositionsView;

  constructor(exchangeName: ExName, settings: Settings = {}) {
    const { isTest } = settings;
    const env: 'testnet' | 'mainnet' = isTest ? 'testnet' : 'mainnet';

    this.#positions = new PositionsRegistry({
      onUpdate: (_position, snapshot) => {
        incrementCounter(PRIVATE_METRICS.positionUpdateCount, 1, {
          env,
          table: 'position',
          symbol: snapshot.symbol,
        });
      },
    });
    this.#positionsView = this.#positions.asReadonly();
    this.#core = new Cores[exchangeName](this, settings);
    this.#isTest = isTest || false;
  }

  get Core() {
    return this.#core;
  }

  get entities() {
    return this.#entities;
  }

  get positions(): PositionsView {
    return this.#positionsView;
  }

  /**
   * Internal mutable registry for core handlers. External consumers should use {@link positions}.
   */
  get positionsRegistry(): PositionsRegistry {
    return this.#positions;
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
