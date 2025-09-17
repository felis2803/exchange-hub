import { EventEmitter } from 'node:events';

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

export type InstrumentChanges = InstrumentUpdate;

export type InstrumentEvents = {
  update: (instrument: Instrument, changes: InstrumentChanges) => void;
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

  constructor(data: InstrumentInit) {
    super();

    this.symbolNative = data.symbolNative;
    this.symbolUni = data.symbolUni;
    this.priceFilters = {};

    this.applyUpdate(data, { emit: false });
  }

  applyUpdate(update: InstrumentUpdate, options: { emit?: boolean } = {}): InstrumentChanges | null {
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

    return changed ? changes : null;
  }
}

export interface Instrument {
  on(event: 'update', listener: InstrumentEvents['update']): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  once(event: 'update', listener: InstrumentEvents['update']): this;
  once(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(event: 'update', listener: InstrumentEvents['update']): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  emit(event: 'update', instrument: Instrument, changes: InstrumentChanges): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
}
