import { EventEmitter } from 'node:events';

import type { BaseEntity, ClOrdID, DomainUpdate, Liquidity, OrderID, Symbol } from '../core/types';
import type { Side } from '../types';

export enum OrderStatus {
    Placed = 'placed',
    PartiallyFilled = 'partiallyFilled',
    Filled = 'filled',
    Canceling = 'canceling',
    Canceled = 'canceled',
    Rejected = 'rejected',
    Expired = 'expired',
}

export type Execution = {
    execId: string;
    ts: number;
    qty: number;
    price: number;
    liquidity?: Liquidity;
};

export type ExecutionUpdate = {
    execId?: string | null;
    ts?: number | string | null;
    qty?: number | null;
    price?: number | null;
    liquidity?: Liquidity | null;
};

export type OrderSnapshot = {
    orderId: OrderID;
    clOrdId: ClOrdID | null;
    symbol: Symbol;
    status: OrderStatus;
    side: Side | null;
    type: string | null;
    timeInForce: string | null;
    execInst: string | null;
    price: number | null;
    stopPrice: number | null;
    qty: number | null;
    leavesQty: number | null;
    filledQty: number;
    avgFillPrice: number | null;
    text: string | null;
    lastUpdateTs: number | null;
    submittedAt: number | null;
    executions: Execution[];
};

export type OrderUpdateReason =
    | 'fill'
    | 'replace'
    | 'cancel-requested'
    | 'canceled'
    | 'rejected'
    | 'expired'
    | 'triggered';

export type OrderInit = Partial<Omit<OrderSnapshot, 'orderId' | 'executions' | 'filledQty' | 'avgFillPrice'>> & {
    orderId: OrderID;
    symbol?: Symbol | null;
    status?: OrderStatus;
    filledQty?: number | null;
    avgFillPrice?: number | null;
};

export type OrderUpdate = Partial<Omit<OrderSnapshot, 'orderId' | 'executions' | 'filledQty' | 'avgFillPrice'>> & {
    cumQty?: number | null;
    avgPx?: number | null;
    execution?: ExecutionUpdate | null;
};

export type OrderUpdateContext = {
    reason?: OrderUpdateReason;
    silent?: boolean;
};

export class Order extends EventEmitter implements BaseEntity<OrderSnapshot> {
    #orderId: OrderID;

    #clOrdId: ClOrdID | null = null;
    #symbol: Symbol;
    #status: OrderStatus;
    #side: Side | null = null;
    #type: string | null = null;
    #timeInForce: string | null = null;
    #execInst: string | null = null;
    #price: number | null = null;
    #stopPrice: number | null = null;
    #qty: number | null = null;
    #leavesQty: number | null = null;
    #text: string | null = null;
    #lastUpdateTs: number | null = null;
    #submittedAt: number | null = null;

    #filledQty = 0;
    #avgFillPrice: number | null = null;
    #fillValue = 0;
    #executions: Execution[] = [];
    #executionIds = new Set<string>();

    get orderId(): OrderID {
        return this.#orderId;
    }

    constructor(init: OrderInit) {
        super();

        const {
            orderId,
            clOrdId,
            symbol,
            status,
            side,
            type,
            timeInForce,
            execInst,
            price,
            stopPrice,
            qty,
            leavesQty,
            text,
            lastUpdateTs,
            submittedAt,
            filledQty,
            avgFillPrice,
        } = init;

        if (typeof orderId !== 'string' || orderId.trim().length === 0) {
            throw new TypeError('Order requires a non-empty orderId');
        }

        this.#orderId = orderId.trim();
        this.#clOrdId = normalizeId(clOrdId);
        this.#symbol = normalizeSymbol(symbol);
        this.#status = status ?? OrderStatus.Placed;
        this.#side = normalizeSide(side);
        this.#type = normalizeString(type);
        this.#timeInForce = normalizeString(timeInForce);
        this.#execInst = normalizeString(execInst);
        this.#price = normalizeOptionalNumber(price);
        this.#stopPrice = normalizeOptionalNumber(stopPrice);
        this.#qty = normalizeOptionalNumber(qty);
        this.#leavesQty = normalizeOptionalNumber(leavesQty);
        this.#text = normalizeString(text);
        this.#lastUpdateTs = normalizeTimestamp(lastUpdateTs);
        this.#submittedAt = normalizeTimestamp(submittedAt);

        const initialFilled = normalizeQuantity(filledQty);

        if (initialFilled !== null) {
            this.#filledQty = initialFilled;
        }

        const initialAvg = normalizeOptionalNumber(avgFillPrice);

        if (initialAvg !== null && this.#filledQty > 0) {
            this.#avgFillPrice = initialAvg;
            this.#fillValue = initialAvg * this.#filledQty;
        } else if (this.#filledQty === 0) {
            this.#avgFillPrice = null;
            this.#fillValue = 0;
        }
    }

    get clOrdId(): ClOrdID | null {
        return this.#clOrdId;
    }

    get symbol(): Symbol {
        return this.#symbol;
    }

    get status(): OrderStatus {
        return this.#status;
    }

    get filledQty(): number {
        return this.#filledQty;
    }

    get avgFillPrice(): number | null {
        return this.#avgFillPrice;
    }

    getSnapshot(): OrderSnapshot {
        return {
            orderId: this.orderId,
            clOrdId: this.#clOrdId,
            symbol: this.#symbol,
            status: this.#status,
            side: this.#side,
            type: this.#type,
            timeInForce: this.#timeInForce,
            execInst: this.#execInst,
            price: this.#price,
            stopPrice: this.#stopPrice,
            qty: this.#qty,
            leavesQty: this.#leavesQty,
            filledQty: this.#filledQty,
            avgFillPrice: this.#avgFillPrice,
            text: this.#text,
            lastUpdateTs: this.#lastUpdateTs,
            submittedAt: this.#submittedAt,
            executions: this.#executions.map(execution => ({ ...execution })),
        };
    }

    applyUpdate(update: OrderUpdate = {}, context: OrderUpdateContext = {}): DomainUpdate<OrderSnapshot> | null {
        const { reason, silent = false } = context;
        const prevSnapshot = this.getSnapshot();
        const changed = new Set<keyof OrderSnapshot>();

        if ('clOrdId' in update) {
            const next = normalizeId(update.clOrdId);

            if (!Object.is(this.#clOrdId, next)) {
                this.#clOrdId = next;
                changed.add('clOrdId');
            }
        }

        if ('symbol' in update) {
            const next = normalizeSymbol(update.symbol);

            if (!Object.is(this.#symbol, next)) {
                this.#symbol = next;
                changed.add('symbol');
            }
        }

        if ('side' in update) {
            const next = normalizeSide(update.side);

            if (!Object.is(this.#side, next)) {
                this.#side = next;
                changed.add('side');
            }
        }

        if ('type' in update) {
            const next = normalizeString(update.type);

            if (!Object.is(this.#type, next)) {
                this.#type = next;
                changed.add('type');
            }
        }

        if ('timeInForce' in update) {
            const next = normalizeString(update.timeInForce);

            if (!Object.is(this.#timeInForce, next)) {
                this.#timeInForce = next;
                changed.add('timeInForce');
            }
        }

        if ('execInst' in update) {
            const next = normalizeString(update.execInst);

            if (!Object.is(this.#execInst, next)) {
                this.#execInst = next;
                changed.add('execInst');
            }
        }

        if ('price' in update) {
            const next = normalizeOptionalNumber(update.price);

            if (!Object.is(this.#price, next)) {
                this.#price = next;
                changed.add('price');
            }
        }

        if ('stopPrice' in update) {
            const next = normalizeOptionalNumber(update.stopPrice);

            if (!Object.is(this.#stopPrice, next)) {
                this.#stopPrice = next;
                changed.add('stopPrice');
            }
        }

        if ('qty' in update) {
            const next = normalizeOptionalNumber(update.qty);

            if (!Object.is(this.#qty, next)) {
                this.#qty = next;
                changed.add('qty');
            }
        }

        if ('leavesQty' in update) {
            const next = normalizeOptionalNumber(update.leavesQty);

            if (!Object.is(this.#leavesQty, next)) {
                this.#leavesQty = next;
                changed.add('leavesQty');
            }
        }

        if ('text' in update) {
            const next = normalizeString(update.text);

            if (!Object.is(this.#text, next)) {
                this.#text = next;
                changed.add('text');
            }
        }

        if ('lastUpdateTs' in update) {
            const next = normalizeTimestamp(update.lastUpdateTs);

            if (!Object.is(this.#lastUpdateTs, next)) {
                this.#lastUpdateTs = next;
                changed.add('lastUpdateTs');
            }
        }

        if ('submittedAt' in update) {
            const next = normalizeTimestamp(update.submittedAt);

            if (!Object.is(this.#submittedAt, next)) {
                this.#submittedAt = next;
                changed.add('submittedAt');
            }
        }

        if ('status' in update && update.status) {
            if (!Object.is(this.#status, update.status)) {
                this.#status = update.status;
                changed.add('status');
            }
        }

        const executionResult = this.#recordExecution(update);

        if (executionResult.qtyDelta > 0) {
            const nextFilled = this.#filledQty + executionResult.qtyDelta;

            if (!Object.is(this.#filledQty, nextFilled)) {
                this.#filledQty = nextFilled;
                changed.add('filledQty');
            }

            const nextValue = this.#fillValue + executionResult.valueDelta;

            if (!Number.isNaN(nextValue) && !Object.is(this.#fillValue, nextValue)) {
                this.#fillValue = nextValue;
            }

            const nextAvg = this.#filledQty > 0 ? this.#fillValue / this.#filledQty : null;

            if (!Object.is(this.#avgFillPrice, nextAvg)) {
                this.#avgFillPrice = nextAvg;
                changed.add('avgFillPrice');
            }
        }

        if (executionResult.added) {
            changed.add('executions');
        }

        let cumQtyProvided = false;
        let normalizedCumQty: number | null = null;

        if ('cumQty' in update) {
            cumQtyProvided = true;
            normalizedCumQty = normalizeQuantity(update.cumQty);

            if (normalizedCumQty !== null && !Object.is(this.#filledQty, normalizedCumQty)) {
                this.#filledQty = normalizedCumQty;
                changed.add('filledQty');
            }
        }

        let avgPxProvided = false;
        let normalizedAvgPx: number | null = null;

        if ('avgPx' in update) {
            avgPxProvided = true;
            normalizedAvgPx = normalizeOptionalNumber(update.avgPx);
        }

        if (cumQtyProvided) {
            const currentFilled = this.#filledQty;

            if (currentFilled <= 0) {
                this.#filledQty = 0;
                this.#fillValue = 0;

                if (this.#avgFillPrice !== null) {
                    this.#avgFillPrice = null;
                    changed.add('avgFillPrice');
                }
            } else {
                let nextAvg = this.#avgFillPrice;

                if (avgPxProvided && normalizedAvgPx !== null) {
                    nextAvg = normalizedAvgPx;
                }

                if (nextAvg !== null) {
                    const nextValue = nextAvg * currentFilled;

                    if (!Object.is(this.#fillValue, nextValue)) {
                        this.#fillValue = nextValue;
                    }

                    if (!Object.is(this.#avgFillPrice, nextAvg)) {
                        this.#avgFillPrice = nextAvg;
                        changed.add('avgFillPrice');
                    }
                } else if (this.#fillValue > 0) {
                    const derivedAvg = this.#fillValue / currentFilled;

                    if (!Object.is(this.#avgFillPrice, derivedAvg)) {
                        this.#avgFillPrice = derivedAvg;
                        changed.add('avgFillPrice');
                    }
                }
            }
        } else if (avgPxProvided && normalizedAvgPx !== null && this.#filledQty > 0) {
            const nextValue = normalizedAvgPx * this.#filledQty;

            if (!Object.is(this.#fillValue, nextValue)) {
                this.#fillValue = nextValue;
            }

            if (!Object.is(this.#avgFillPrice, normalizedAvgPx)) {
                this.#avgFillPrice = normalizedAvgPx;
                changed.add('avgFillPrice');
            }
        }

        if (this.#filledQty === 0) {
            if (this.#avgFillPrice !== null) {
                this.#avgFillPrice = null;
                changed.add('avgFillPrice');
            }

            if (this.#fillValue !== 0) {
                this.#fillValue = 0;
            }
        }

        if (reason === 'fill' && this.#status === OrderStatus.Canceling && !changed.has('status')) {
            const derivedStatus = this.#deriveStatusAfterFill();

            if (derivedStatus && !Object.is(this.#status, derivedStatus)) {
                this.#status = derivedStatus;
                changed.add('status');
            }
        }

        if (changed.size === 0) {
            return null;
        }

        const nextSnapshot = this.getSnapshot();
        const diff: DomainUpdate<OrderSnapshot> = {
            prev: prevSnapshot,
            next: nextSnapshot,
            changed: Array.from(changed),
        };

        if (!silent) {
            this.emit('update', nextSnapshot, diff, reason);
        }

        return diff;
    }

    markCanceling(reason?: OrderUpdateReason): DomainUpdate<OrderSnapshot> | null {
        if (this.#status === OrderStatus.Canceling) {
            return null;
        }

        return this.applyUpdate({ status: OrderStatus.Canceling }, { reason: reason ?? 'cancel-requested' });
    }

    #recordExecution(update: OrderUpdate): { added: boolean; qtyDelta: number; valueDelta: number } {
        const exec = update.execution;

        if (!exec) {
            return { added: false, qtyDelta: 0, valueDelta: 0 };
        }

        const execId = normalizeId(exec.execId);

        if (!execId) {
            return { added: false, qtyDelta: 0, valueDelta: 0 };
        }

        if (this.#executionIds.has(execId)) {
            return { added: false, qtyDelta: 0, valueDelta: 0 };
        }

        let qty = normalizeQuantity(exec.qty);

        if ((qty === null || qty === 0) && 'cumQty' in update) {
            const normalizedCum = normalizeQuantity(update.cumQty);

            if (normalizedCum !== null) {
                const diff = normalizedCum - this.#filledQty;

                if (Number.isFinite(diff) && diff > 0) {
                    qty = diff;
                }
            }
        }

        if (qty === null || qty <= 0) {
            this.#executionIds.add(execId);

            return { added: false, qtyDelta: 0, valueDelta: 0 };
        }

        let price = normalizeOptionalNumber(exec.price);

        if (price === null) {
            if ('avgPx' in update) {
                const normalizedAvgPx = normalizeOptionalNumber(update.avgPx);

                if (normalizedAvgPx !== null) {
                    price = normalizedAvgPx;
                }
            }

            if (price === null && this.#avgFillPrice !== null) {
                price = this.#avgFillPrice;
            }
        }

        if (price === null) {
            price = 0;
        }

        const ts = normalizeTimestamp(exec.ts) ?? Date.now();
        const liquidity = exec.liquidity ?? undefined;

        const execution: Execution = {
            execId,
            qty,
            price,
            ts,
            ...(liquidity ? { liquidity } : {}),
        };

        this.#executionIds.add(execId);
        this.#executions.push(execution);

        const valueDelta = price * qty;

        return { added: true, qtyDelta: qty, valueDelta };
    }

    override on(
        event: 'update',
        listener: (snapshot: OrderSnapshot, diff: DomainUpdate<OrderSnapshot>, reason?: OrderUpdateReason) => void,
    ): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this;

    override on(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    override once(
        event: 'update',
        listener: (snapshot: OrderSnapshot, diff: DomainUpdate<OrderSnapshot>, reason?: OrderUpdateReason) => void,
    ): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this;

    override once(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    override off(
        event: 'update',
        listener: (snapshot: OrderSnapshot, diff: DomainUpdate<OrderSnapshot>, reason?: OrderUpdateReason) => void,
    ): this;

    override off(event: string | symbol, listener: (...args: any[]) => void): this;

    override off(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    #deriveStatusAfterFill(): OrderStatus | null {
        if (this.#filledQty <= 0) {
            return null;
        }

        if (this.#leavesQty !== null) {
            return this.#leavesQty <= 0 ? OrderStatus.Filled : OrderStatus.PartiallyFilled;
        }

        if (this.#qty !== null && this.#filledQty >= this.#qty) {
            return OrderStatus.Filled;
        }

        return OrderStatus.PartiallyFilled;
    }
}

function normalizeId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSymbol(value: unknown): Symbol {
    if (typeof value !== 'string') {
        return '' as Symbol;
    }

    return value.trim() as Symbol;
}

function normalizeSide(value: unknown): Side | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'buy' || normalized === 'sell') {
        return normalized as Side;
    }

    return null;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
    if (typeof value !== 'number') {
        return null;
    }

    if (!Number.isFinite(value)) {
        return null;
    }

    return value;
}

function normalizeQuantity(value: unknown): number | null {
    if (typeof value !== 'number') {
        return null;
    }

    if (!Number.isFinite(value)) {
        return null;
    }

    if (value <= 0) {
        return value === 0 ? 0 : null;
    }

    return value;
}

function normalizeTimestamp(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
        const ts = Date.parse(value);

        return Number.isFinite(ts) ? ts : null;
    }

    return null;
}
