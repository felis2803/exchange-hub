import { EventEmitter } from 'node:events';

import { createLogger } from '../infra/logger';
import type { L2BatchDelta, L2Best, L2Row } from '../types/orderbook';

type L2UpdateRow = Pick<L2Row, 'id'> & Partial<Omit<L2Row, 'id'>>;

type PriceLevel = {
    totalSize: number;
    orderIds: Set<number>;
};

export class OrderBookL2 extends EventEmitter {
    readonly log = createLogger('orderbook:l2');

    readonly rows = new Map<number, L2Row>();

    bestBid: L2Best | null = null;
    bestAsk: L2Best | null = null;
    outOfSync = false;

    #levels: Record<'buy' | 'sell', Map<number, PriceLevel>> = {
        buy: new Map(),
        sell: new Map(),
    };

    // --- Events typing ---
    override on(event: 'update', listener: (delta: L2BatchDelta) => void): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    override once(event: 'update', listener: (delta: L2BatchDelta) => void): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    override off(event: 'update', listener: (delta: L2BatchDelta) => void): this;

    override off(event: string | symbol, listener: (...args: any[]) => void): this;

    override off(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    override emit(event: 'update', delta: L2BatchDelta): boolean;

    override emit(event: string | symbol, ...args: any[]): boolean;

    override emit(event: string | symbol, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    reset(snapshot: L2Row[]): void {
        this.rows.clear();
        this.#levels.buy.clear();
        this.#levels.sell.clear();
        this.bestBid = null;
        this.bestAsk = null;
        this.outOfSync = false;

        for (const row of snapshot) {
            this.#insertRow(row);
        }

        this.#refreshBest('buy');
        this.#refreshBest('sell');
    }

    applyInsert(rows: L2Row[]): L2BatchDelta {
        let bids = 0;
        let asks = 0;
        const touched = new Set<'buy' | 'sell'>();

        for (const row of rows) {
            const inserted = this.#insertRow(row);

            if (!inserted) {
                continue;
            }

            touched.add(row.side);

            if (row.side === 'buy') {
                bids += 1;
            } else {
                asks += 1;
            }
        }

        for (const side of touched) {
            this.#refreshBest(side);
        }

        return this.#buildDelta(bids, asks);
    }

    applyUpdate(rows: L2UpdateRow[]): L2BatchDelta {
        let bids = 0;
        let asks = 0;
        const touched = new Set<'buy' | 'sell'>();

        for (const update of rows) {
            const current = this.rows.get(update.id);

            if (!current) {
                this.outOfSync = true;
                continue;
            }

            const { side } = current;
            const nextPrice = update.price ?? current.price;
            const nextSize = update.size ?? current.size;

            if (update.side && update.side !== side) {
                this.outOfSync = true;
                continue;
            }

            touched.add(side);

            if (side === 'buy') {
                bids += 1;
            } else {
                asks += 1;
            }

            if (nextPrice !== current.price) {
                this.#removeFromLevel(side, current.price, current.id, current.size);
                current.price = nextPrice;
                current.size = nextSize;
                this.#addToLevel(current);
                continue;
            }

            if (nextSize !== current.size) {
                const deltaSize = nextSize - current.size;

                current.size = nextSize;
                this.#updateLevelSize(side, nextPrice, current.id, deltaSize);
            }
        }

        for (const side of touched) {
            this.#refreshBest(side);
        }

        return this.#buildDelta(bids, asks);
    }

    applyDelete(ids: number[]): L2BatchDelta {
        let bids = 0;
        let asks = 0;
        const touched = new Set<'buy' | 'sell'>();

        for (const id of ids) {
            const current = this.rows.get(id);

            if (!current) {
                this.outOfSync = true;
                continue;
            }

            touched.add(current.side);

            if (current.side === 'buy') {
                bids += 1;
            } else {
                asks += 1;
            }

            this.rows.delete(id);
            this.#removeFromLevel(current.side, current.price, current.id, current.size);
        }

        for (const side of touched) {
            this.#refreshBest(side);
        }

        return this.#buildDelta(bids, asks);
    }

    #insertRow(row: L2Row): boolean {
        if (!row || typeof row.id !== 'number') {
            return false;
        }

        if (this.rows.has(row.id)) {
            this.outOfSync = true;
            this.log.warn('duplicate L2 id', { id: row.id });

            return false;
        }

        const normalized: L2Row = {
            id: row.id,
            side: row.side,
            price: row.price,
            size: row.size,
        };

        this.rows.set(normalized.id, normalized);
        this.#addToLevel(normalized);

        return true;
    }

    #addToLevel(row: L2Row): void {
        const level = this.#ensureLevel(row.side, row.price);

        if (!level.orderIds.has(row.id)) {
            level.orderIds.add(row.id);
            level.totalSize += row.size;

            return;
        }

        const previous = this.rows.get(row.id);

        if (previous) {
            const delta = row.size - previous.size;

            if (delta !== 0) {
                level.totalSize = Math.max(0, level.totalSize + delta);
            }
        }
    }

    #removeFromLevel(side: 'buy' | 'sell', price: number, id: number, size: number): void {
        const levels = this.#levels[side];
        const level = levels.get(price);

        if (!level) {
            this.outOfSync = true;

            return;
        }

        if (!level.orderIds.delete(id)) {
            this.outOfSync = true;

            return;
        }

        level.totalSize = Math.max(0, level.totalSize - size);

        if (level.orderIds.size === 0) {
            levels.delete(price);
        }
    }

    #updateLevelSize(side: 'buy' | 'sell', price: number, id: number, deltaSize: number): void {
        if (deltaSize === 0) {
            return;
        }

        const level = this.#levels[side].get(price);

        if (!level || !level.orderIds.has(id)) {
            this.outOfSync = true;

            return;
        }

        level.totalSize = Math.max(0, level.totalSize + deltaSize);
    }

    #refreshBest(side: 'buy' | 'sell'): void {
        const levels = this.#levels[side];
        let bestPrice: number | null = null;
        let bestSize = 0;

        for (const [price, level] of levels) {
            if (level.orderIds.size === 0) {
                levels.delete(price);
                continue;
            }

            if (bestPrice === null) {
                bestPrice = price;
                bestSize = level.totalSize;
                continue;
            }

            if (side === 'buy') {
                if (price > bestPrice || (price === bestPrice && level.totalSize > bestSize)) {
                    bestPrice = price;
                    bestSize = level.totalSize;
                }
            } else if (price < bestPrice || (price === bestPrice && level.totalSize > bestSize)) {
                bestPrice = price;
                bestSize = level.totalSize;
            }
        }

        if (side === 'buy') {
            this.bestBid = bestPrice === null ? null : { price: bestPrice, size: bestSize };
        } else {
            this.bestAsk = bestPrice === null ? null : { price: bestPrice, size: bestSize };
        }
    }

    #ensureLevel(side: 'buy' | 'sell', price: number): PriceLevel {
        const levels = this.#levels[side];
        let level = levels.get(price);

        if (!level) {
            level = { totalSize: 0, orderIds: new Set() };
            levels.set(price, level);
        }

        return level;
    }

    #buildDelta(bids: number, asks: number): L2BatchDelta {
        return {
            changed: { bids, asks },
            bestBid: this.bestBid,
            bestAsk: this.bestAsk,
        };
    }
}

export type { L2BatchDelta, L2Best, L2Row };
