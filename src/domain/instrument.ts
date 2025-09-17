import { EventEmitter } from 'node:events';

import type { Side } from '../types.js';

export type Nullable<T> = T | null | undefined;

export type InstrumentStatus =
  | 'open'
  | 'closed'
  | 'settled'
  | 'unlisted'
  | 'delisted'
  | (string & {});

export type InstrumentPriceFilters = {
  minPrice?: Nullable<number>;
  maxPrice?: Nullable<number>;
  limitDownPrice?: Nullable<number>;
  limitUpPrice?: Nullable<number>;
};

export type InstrumentShape = {
  symbolNative: string;
  symbolUni: string;
  status?: Nullable<InstrumentStatus>;
  type?: Nullable<string>;
  baseCurrency?: Nullable<string>;
  quoteCurrency?: Nullable<string>;
  lotSize?: Nullable<number>;
  tickSize?: Nullable<number>;
  multiplier?: Nullable<number>;
  markPrice?: Nullable<number>;
  indexPrice?: Nullable<number>;
  lastPrice?: Nullable<number>;
  lastChangePcnt?: Nullable<number>;
  openInterest?: Nullable<number>;
  turnover24h?: Nullable<number>;
  volume24h?: Nullable<number>;
  fundingRate?: Nullable<number>;
  indicativeFundingRate?: Nullable<number>;
  fundingTimestamp?: Nullable<string>;
  fundingInterval?: Nullable<string>;
  expiry?: Nullable<string>;
  timestamp?: Nullable<string>;
};

export type InstrumentInit = InstrumentShape & {
  priceFilters?: InstrumentPriceFilters;
};

export type InstrumentUpdate = Partial<InstrumentShape> & {
  priceFilters?: InstrumentPriceFilters;
};

export type InstrumentTrade = {
  ts: number;
  side: Side;
  price: number;
  size?: number;
  id?: string;
  foreignNotional?: number;
};

export type InstrumentTradePushOptions = {
  reset?: boolean;
};

export type InstrumentTradePushResult = {
  inserted: InstrumentTrade[];
  dropped: number;
  reset: boolean;
};

type InstrumentTradeInsertMeta = {
  reset: boolean;
  dropped: number;
};

type InstrumentTradeInsertListener = (
  trades: InstrumentTrade[],
  meta: InstrumentTradeInsertMeta,
) => void;

export class InstrumentTradesBuffer {
  #buffer: InstrumentTrade[] = [];
  #capacity: number;
  #onInsert: InstrumentTradeInsertListener;

  constructor(capacity: number, onInsert: InstrumentTradeInsertListener) {
    this.#capacity = InstrumentTradesBuffer.#normalizeCapacity(capacity);
    this.#onInsert = onInsert;
  }

  static #normalizeCapacity(size: number): number {
    if (!Number.isFinite(size) || size <= 0) {
      return 1;
    }

    return Math.max(1, Math.floor(size));
  }

  get capacity(): number {
    return this.#capacity;
  }

  get length(): number {
    return this.#buffer.length;
  }

  push(
    batch: InstrumentTrade[],
    options: InstrumentTradePushOptions = {},
  ): InstrumentTradePushResult {
    const { reset = false } = options;

    if (reset) {
      this.#buffer = [];
    }

    if (!Array.isArray(batch) || batch.length === 0) {
      return { inserted: [], dropped: 0, reset };
    }

    const inserted: InstrumentTrade[] = [];

    for (const trade of batch) {
      if (!trade) {
        continue;
      }

      const normalized: InstrumentTrade = Object.freeze({ ...trade });
      this.#buffer.push(normalized);
      inserted.push(normalized);
    }

    let dropped = 0;

    if (this.#buffer.length > this.#capacity) {
      dropped = this.#buffer.length - this.#capacity;
      this.#buffer.splice(0, dropped);
    }

    if (inserted.length > 0) {
      this.#onInsert(inserted, { reset, dropped });
    }

    return { inserted, dropped, reset };
  }

  toArray(): InstrumentTrade[] {
    return this.#buffer.slice();
  }
}

export type InstrumentChanges = InstrumentUpdate & {
  trades?: InstrumentTrade[];
};

export type InstrumentOptions = {
  tradeBufferSize?: number;
  tradeEventEnabled?: boolean;
};

const WRITABLE_FIELDS: (keyof InstrumentShape)[] = [
  'symbolNative',
  'symbolUni',
  'status',
  'type',
  'baseCurrency',
  'quoteCurrency',
  'lotSize',
  'tickSize',
  'multiplier',
  'markPrice',
  'indexPrice',
  'lastPrice',
  'lastChangePcnt',
  'openInterest',
  'turnover24h',
  'volume24h',
  'fundingRate',
  'indicativeFundingRate',
  'fundingTimestamp',
  'fundingInterval',
  'expiry',
  'timestamp',
];

export class Instrument extends EventEmitter {
  static readonly DEFAULT_TRADE_BUFFER_SIZE = 1_000;

  static normalizeTradeBufferSize(size?: number): number {
    if (!Number.isFinite(size)) {
      return Instrument.DEFAULT_TRADE_BUFFER_SIZE;
    }

    const normalized = Math.floor(size as number);

    if (!Number.isFinite(normalized) || normalized <= 0) {
      return Instrument.DEFAULT_TRADE_BUFFER_SIZE;
    }

    return Math.max(1, normalized);
  }

  #tradeEventEnabled: boolean;

  public symbolNative: string;
  public symbolUni: string;
  public status?: Nullable<InstrumentStatus>;
  public type?: Nullable<string>;
  public baseCurrency?: Nullable<string>;
  public quoteCurrency?: Nullable<string>;
  public lotSize?: Nullable<number>;
  public tickSize?: Nullable<number>;
  public multiplier?: Nullable<number>;
  public markPrice?: Nullable<number>;
  public indexPrice?: Nullable<number>;
  public lastPrice?: Nullable<number>;
  public lastChangePcnt?: Nullable<number>;
  public openInterest?: Nullable<number>;
  public turnover24h?: Nullable<number>;
  public volume24h?: Nullable<number>;
  public fundingRate?: Nullable<number>;
  public indicativeFundingRate?: Nullable<number>;
  public fundingTimestamp?: Nullable<string>;
  public fundingInterval?: Nullable<string>;
  public expiry?: Nullable<string>;
  public timestamp?: Nullable<string>;
  public priceFilters: InstrumentPriceFilters;
  public readonly trades: InstrumentTradesBuffer;

  override on(
    event: 'update',
    listener: (instrument: Instrument, changes: InstrumentChanges) => void,
  ): this;
  override on(
    event: 'trade',
    listener: (instrument: Instrument, trades: InstrumentTrade[]) => void,
  ): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override once(
    event: 'update',
    listener: (instrument: Instrument, changes: InstrumentChanges) => void,
  ): this;
  override once(
    event: 'trade',
    listener: (instrument: Instrument, trades: InstrumentTrade[]) => void,
  ): this;
  override once(event: string | symbol, listener: (...args: any[]) => void): this;
  override once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  override off(
    event: 'update',
    listener: (instrument: Instrument, changes: InstrumentChanges) => void,
  ): this;
  override off(
    event: 'trade',
    listener: (instrument: Instrument, trades: InstrumentTrade[]) => void,
  ): this;
  override off(event: string | symbol, listener: (...args: any[]) => void): this;
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  override emit(event: 'update', instrument: Instrument, changes: InstrumentChanges): boolean;
  override emit(event: 'trade', instrument: Instrument, trades: InstrumentTrade[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  constructor(data: InstrumentInit, options: InstrumentOptions = {}) {
    super();

    const { tradeBufferSize, tradeEventEnabled } = options;
    const bufferSize = Instrument.normalizeTradeBufferSize(tradeBufferSize);

    this.symbolNative = data.symbolNative;
    this.symbolUni = data.symbolUni;
    this.priceFilters = {};
    this.trades = new InstrumentTradesBuffer(bufferSize, (trades, meta) =>
      this.#handleTradesInserted(trades, meta),
    );
    this.#tradeEventEnabled = tradeEventEnabled ?? false;

    this.applyUpdate(data, { emit: false });
  }

  #handleTradesInserted(trades: InstrumentTrade[], _meta: InstrumentTradeInsertMeta): void {
    if (trades.length === 0) {
      return;
    }

    const changes: InstrumentChanges = { trades };
    this.emit('update', this, changes);

    if (this.#tradeEventEnabled) {
      this.emit('trade', this, trades);
    }
  }

  get tradeBufferSize(): number {
    return this.trades.capacity;
  }

  get tradeEventEnabled(): boolean {
    return this.#tradeEventEnabled;
  }

  setTradeEventEnabled(enabled: boolean): void {
    this.#tradeEventEnabled = Boolean(enabled);
  }

  enableTradeEvents(): void {
    this.setTradeEventEnabled(true);
  }

  disableTradeEvents(): void {
    this.setTradeEventEnabled(false);
  }

  applyUpdate(update: InstrumentUpdate, options: { emit?: boolean } = {}): boolean {
    const { emit = true } = options;
    let changed = false;
    const changes: InstrumentChanges = {};

    for (const field of WRITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(update, field)) {
        continue;
      }

      const nextValue = update[field];
      if (!Object.is((this as any)[field], nextValue)) {
        (this as any)[field] = nextValue;
        (changes as any)[field] = nextValue;
        changed = true;
      }
    }

    if (update.priceFilters) {
      const filterChanges: InstrumentPriceFilters = {};

      for (const key of Object.keys(update.priceFilters) as (keyof InstrumentPriceFilters)[]) {
        if (!Object.prototype.hasOwnProperty.call(update.priceFilters, key)) {
          continue;
        }

        const next = update.priceFilters[key];
        const current = this.priceFilters[key];

        if (!Object.is(current, next)) {
          if (next === undefined) {
            delete this.priceFilters[key];
          } else {
            this.priceFilters[key] = next;
          }

          filterChanges[key] = next;
          changed = true;
        }
      }

      if (Object.keys(filterChanges).length > 0) {
        changes.priceFilters = filterChanges;
      }
    }

    if (changed && emit) {
      this.emit('update', this, changes);
    }

    return changed;
  }
}
