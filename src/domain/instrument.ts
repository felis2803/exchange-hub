import { EventEmitter } from 'node:events';

import { OrderBookL2 } from './orderBookL2';

import { inferOrderType } from '../core/bitmex/mappers/order';
import type { Trade as NormalizedTrade } from '../types/bitmex';
import type { Side } from '../types';
import { genClOrdID } from '../infra/ids';
import { validatePlaceInput, type PlaceOpts, type PreparedPlaceInput } from '../infra/validation';

export type Nullable<T> = T | null | undefined;

export type InstrumentStatus = 'open' | 'closed' | 'settled' | 'unlisted' | 'delisted' | (string & {});

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

export type InstrumentTrade = NormalizedTrade;

export type InstrumentTradePushOptions = {
    reset?: boolean;
    silent?: boolean;
};

export type InstrumentTradePushResult = {
    added: number;
    dropped: number;
    reset: boolean;
};

type InstrumentTradePushMeta = {
    reset: boolean;
    dropped: number;
    added: number;
};

type InstrumentTradeInsertListener = (trades: InstrumentTrade[], meta: InstrumentTradePushMeta) => void;

const TRADE_SEEN_IDS_CAPACITY = 10_000;

export class InstrumentTradesBuffer {
    #buffer: InstrumentTrade[] = [];
    #capacity: number;
    #onInsert: InstrumentTradeInsertListener;
    #seenIds = new Set<string>();
    #seenCapacity: number;

    constructor(capacity: number, onInsert: InstrumentTradeInsertListener) {
        this.#capacity = InstrumentTradesBuffer.#normalizeCapacity(capacity);
        this.#onInsert = onInsert;
        this.#seenCapacity = InstrumentTradesBuffer.#normalizeCapacity(TRADE_SEEN_IDS_CAPACITY);
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

    push(batch: InstrumentTrade[], options: InstrumentTradePushOptions = {}): InstrumentTradePushResult {
        const { reset = false, silent = false } = options;

        if (reset) {
            this.#buffer = [];
            this.#seenIds.clear();
        }

        if (!Array.isArray(batch) || batch.length === 0) {
            return { added: 0, dropped: 0, reset };
        }

        const inserted: InstrumentTrade[] = [];

        for (const trade of batch) {
            if (!trade) {
                continue;
            }

            const normalizedId =
                typeof trade.id === 'string' && trade.id.trim().length > 0 ? trade.id.trim() : undefined;

            if (normalizedId && this.#seenIds.has(normalizedId)) {
                continue;
            }

            const normalized: InstrumentTrade = Object.freeze({
                ...trade,
                ...(normalizedId ? { id: normalizedId } : {}),
            });

            if (normalizedId) {
                this.#rememberTradeId(normalizedId);
            }

            const index = this.#findInsertIndex(normalized.ts);

            this.#buffer.splice(index, 0, normalized);
            inserted.push(normalized);
        }

        let dropped = 0;

        if (this.#buffer.length > this.#capacity) {
            dropped = this.#buffer.length - this.#capacity;
            this.#buffer.splice(0, dropped);
        }

        if (!silent && inserted.length > 0) {
            this.#onInsert(inserted, { reset, dropped, added: inserted.length });
        }

        return { added: inserted.length, dropped, reset };
    }

    toArray(): InstrumentTrade[] {
        return this.#buffer.slice();
    }

    #findInsertIndex(ts: number): number {
        if (!Number.isFinite(ts) || this.#buffer.length === 0) {
            return this.#buffer.length;
        }

        let low = 0;
        let high = this.#buffer.length;

        while (low < high) {
            const mid = (low + high) >>> 1;
            const current = this.#buffer[mid];

            if (!current) {
                break;
            }

            if (current.ts > ts) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low;
    }

    #rememberTradeId(id: string): void {
        if (!id) {
            return;
        }

        if (this.#seenIds.has(id)) {
            this.#seenIds.delete(id);
        }

        this.#seenIds.add(id);

        if (this.#seenIds.size > this.#seenCapacity) {
            const oldest = this.#seenIds.values().next().value;

            if (oldest !== undefined) {
                this.#seenIds.delete(oldest);
            }
        }
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
    #orderBook?: OrderBookL2;

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

    get orderBook(): OrderBookL2 {
        if (!this.#orderBook) {
            this.#orderBook = new OrderBookL2();
        }

        return this.#orderBook;
    }

    buy(size: number, price?: number, opts?: PlaceOpts): PreparedPlaceInput {
        return this.#preparePlace('buy', size, price, opts);
    }

    sell(size: number, price?: number, opts?: PlaceOpts): PreparedPlaceInput {
        return this.#preparePlace('sell', size, price, opts);
    }

    /**
     * Prepares a normalized payload for placing orders.
     *
     * We rely on the latest top-of-book snapshot to pick the safest default. If
     * quotes are not yet available we stick to a limit order instead of risking a
     * stop order. Prices that match the current best bid/ask are also considered
     * passive limits to avoid crossing the spread due to rounding noise.
     */
    #preparePlace(side: Side, size: number, price?: number, opts?: PlaceOpts): PreparedPlaceInput {
        const book = this.#orderBook ?? this.orderBook;
        const bestBid = book.bestBid?.price ?? undefined;
        const bestAsk = book.bestAsk?.price ?? undefined;

        const type = inferOrderType(side, price, bestBid, bestAsk, opts?.stopLimitPrice ?? null);
        const validated = validatePlaceInput({
            symbol: this.symbolNative,
            side,
            size,
            price,
            type,
            opts,
            bestBid,
            bestAsk,
        });

        const clOrdId = validated.options.clOrdId ?? genClOrdID();

        return {
            ...validated,
            options: { ...validated.options, clOrdId },
        };
    }

    override on(event: 'update', listener: (instrument: Instrument, changes: InstrumentChanges) => void): this;

    override on(event: 'trade', listener: (instrument: Instrument, trades: InstrumentTrade[]) => void): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    override once(event: 'update', listener: (instrument: Instrument, changes: InstrumentChanges) => void): this;

    override once(event: 'trade', listener: (instrument: Instrument, trades: InstrumentTrade[]) => void): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    override off(event: 'update', listener: (instrument: Instrument, changes: InstrumentChanges) => void): this;

    override off(event: 'trade', listener: (instrument: Instrument, trades: InstrumentTrade[]) => void): this;

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

    #handleTradesInserted(trades: InstrumentTrade[], _meta: InstrumentTradePushMeta): void {
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
