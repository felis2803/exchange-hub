import { Order, OrderStatus, type OrderInit, type OrderUpdateReason } from '../domain/order';
import type { ClOrdID, OrderID, Symbol, DomainUpdate } from './types';

export type { PlaceOpts, OrderType, PreparedPlaceInput } from '../infra/validation';

type OrderListener = (
    snapshot: ReturnType<Order['getSnapshot']>,
    diff: DomainUpdate<ReturnType<Order['getSnapshot']>>,
    reason?: OrderUpdateReason,
) => void;

export class OrdersRegistry {
    #byOrderId = new Map<OrderID, Order>();
    #byClOrdId = new Map<string, Order>();
    #bySymbol = new Map<string, Set<Order>>();
    #activeOrders = new Set<Order>();
    #activeBySymbol = new Map<string, Set<Order>>();
    #inflightByClOrdId = new Map<string, Promise<Order>>();
    #listeners = new Map<Order, OrderListener>();

    get size(): number {
        return this.#byOrderId.size;
    }

    values(): Order[] {
        return Array.from(this.#byOrderId.values());
    }

    getByOrderId(orderId: OrderID | null | undefined): Order | undefined {
        if (typeof orderId !== 'string') {
            return undefined;
        }

        return this.#byOrderId.get(orderId);
    }

    getByClOrdId(clOrdId: ClOrdID | null | undefined): Order | undefined {
        const key = normalizeClOrdId(clOrdId);

        return key ? this.#byClOrdId.get(key) : undefined;
    }

    getInflightByClOrdId(clOrdId: ClOrdID | null | undefined): Promise<Order> | undefined {
        const key = normalizeClOrdId(clOrdId);

        return key ? this.#inflightByClOrdId.get(key) : undefined;
    }

    registerInflight(clOrdId: ClOrdID, promise: Promise<Order>): void {
        const key = normalizeClOrdId(clOrdId);

        if (!key) {
            throw new TypeError('clOrdId must be a non-empty string');
        }

        this.#inflightByClOrdId.set(key, promise);
    }

    clearInflight(clOrdId: ClOrdID | null | undefined): boolean {
        const key = normalizeClOrdId(clOrdId);

        if (!key) {
            return false;
        }

        return this.#inflightByClOrdId.delete(key);
    }

    getBySymbol(symbol: Symbol | null | undefined): Order[] {
        const key = normalizeSymbolKey(symbol);

        if (!key) {
            return [];
        }

        return Array.from(this.#bySymbol.get(key) ?? []);
    }

    getActiveOrders(): Order[] {
        return Array.from(this.#activeOrders);
    }

    getActiveBySymbol(symbol: Symbol | null | undefined): Order[] {
        const key = normalizeSymbolKey(symbol);

        if (!key) {
            return [];
        }

        return Array.from(this.#activeBySymbol.get(key) ?? []);
    }

    resolve(orderId: OrderID | null | undefined, clOrdId: ClOrdID | null | undefined): Order | undefined {
        const byId = this.getByOrderId(orderId);

        if (byId && isActiveStatus(byId.status)) {
            return byId;
        }

        const byCl = this.getByClOrdId(clOrdId);

        if (byCl && isActiveStatus(byCl.status)) {
            return byCl;
        }

        return byId ?? byCl;
    }

    create(orderId: OrderID, init: Omit<OrderInit, 'orderId'> = {}): Order {
        const existing = this.#byOrderId.get(orderId);

        if (existing) {
            return existing;
        }

        const order = new Order({ ...init, orderId });

        this.#register(order);

        return order;
    }

    delete(orderId: OrderID): boolean {
        const order = this.#byOrderId.get(orderId);

        if (!order) {
            return false;
        }

        this.#byOrderId.delete(orderId);
        this.#removeIndexes(order);

        return true;
    }

    clear(): void {
        for (const order of this.#byOrderId.values()) {
            this.#detach(order);
        }

        this.#byOrderId.clear();
        this.#byClOrdId.clear();
        this.#bySymbol.clear();
        this.#activeOrders.clear();
        this.#activeBySymbol.clear();
        this.#inflightByClOrdId.clear();
    }

    #register(order: Order): void {
        this.#byOrderId.set(order.orderId, order);
        this.#index(order, order.getSnapshot());

        const listener: OrderListener = (snapshot, diff) => {
            this.#handleOrderUpdate(order, snapshot, diff);
        };

        order.on('update', listener);
        this.#listeners.set(order, listener);
    }

    #removeIndexes(order: Order): void {
        const listener = this.#listeners.get(order);

        if (listener) {
            order.off('update', listener);
            this.#listeners.delete(order);
        }

        const snapshot = order.getSnapshot();
        const clOrdKey = normalizeClOrdId(snapshot.clOrdId);

        if (clOrdKey && this.#byClOrdId.get(clOrdKey) === order) {
            this.#byClOrdId.delete(clOrdKey);
            this.#inflightByClOrdId.delete(clOrdKey);
        }

        const symbolKey = normalizeSymbolKey(snapshot.symbol);

        if (symbolKey) {
            this.#bySymbol.get(symbolKey)?.delete(order);

            if (this.#bySymbol.get(symbolKey)?.size === 0) {
                this.#bySymbol.delete(symbolKey);
            }
        }

        this.#activeOrders.delete(order);

        if (symbolKey) {
            this.#activeBySymbol.get(symbolKey)?.delete(order);

            if (this.#activeBySymbol.get(symbolKey)?.size === 0) {
                this.#activeBySymbol.delete(symbolKey);
            }
        }
    }

    #index(order: Order, snapshot: ReturnType<Order['getSnapshot']>): void {
        const clOrdKey = normalizeClOrdId(snapshot.clOrdId);

        if (clOrdKey) {
            this.#byClOrdId.set(clOrdKey, order);
            this.#inflightByClOrdId.delete(clOrdKey);
        }

        const symbolKey = normalizeSymbolKey(snapshot.symbol);

        if (symbolKey) {
            if (!this.#bySymbol.has(symbolKey)) {
                this.#bySymbol.set(symbolKey, new Set());
            }

            this.#bySymbol.get(symbolKey)!.add(order);
        }

        if (isActiveStatus(snapshot.status)) {
            this.#activeOrders.add(order);

            if (symbolKey) {
                if (!this.#activeBySymbol.has(symbolKey)) {
                    this.#activeBySymbol.set(symbolKey, new Set());
                }

                this.#activeBySymbol.get(symbolKey)!.add(order);
            }
        }
    }

    #handleOrderUpdate(
        order: Order,
        snapshot: ReturnType<Order['getSnapshot']>,
        diff: DomainUpdate<ReturnType<Order['getSnapshot']>>,
    ): void {
        if (diff.changed.includes('clOrdId')) {
            this.#reindexClOrd(order, diff.prev.clOrdId, snapshot.clOrdId);
        }

        if (diff.changed.includes('symbol')) {
            this.#reindexSymbol(order, diff.prev.symbol, snapshot.symbol);
        }

        if (diff.changed.includes('status') || diff.changed.includes('symbol')) {
            this.#reindexActive(order, diff.prev.symbol, diff.prev.status, snapshot.symbol, snapshot.status);
        }
    }

    #reindexClOrd(order: Order, prev: ClOrdID | null, next: ClOrdID | null): void {
        const prevKey = normalizeClOrdId(prev);

        if (prevKey && this.#byClOrdId.get(prevKey) === order) {
            this.#byClOrdId.delete(prevKey);
            this.#inflightByClOrdId.delete(prevKey);
        }

        const nextKey = normalizeClOrdId(next);

        if (nextKey) {
            this.#byClOrdId.set(nextKey, order);
            this.#inflightByClOrdId.delete(nextKey);
        }
    }

    #reindexSymbol(order: Order, prev: Symbol, next: Symbol): void {
        const prevKey = normalizeSymbolKey(prev);

        if (prevKey) {
            this.#bySymbol.get(prevKey)?.delete(order);

            if (this.#bySymbol.get(prevKey)?.size === 0) {
                this.#bySymbol.delete(prevKey);
            }
        }

        const nextKey = normalizeSymbolKey(next);

        if (nextKey) {
            if (!this.#bySymbol.has(nextKey)) {
                this.#bySymbol.set(nextKey, new Set());
            }

            this.#bySymbol.get(nextKey)!.add(order);
        }
    }

    #reindexActive(
        order: Order,
        prevSymbol: Symbol,
        prevStatus: OrderStatus,
        nextSymbol: Symbol,
        nextStatus: OrderStatus,
    ): void {
        const prevKey = normalizeSymbolKey(prevSymbol);
        const nextKey = normalizeSymbolKey(nextSymbol);

        if (isActiveStatus(prevStatus)) {
            this.#activeOrders.delete(order);

            if (prevKey) {
                this.#activeBySymbol.get(prevKey)?.delete(order);

                if (this.#activeBySymbol.get(prevKey)?.size === 0) {
                    this.#activeBySymbol.delete(prevKey);
                }
            }
        }

        if (isActiveStatus(nextStatus)) {
            this.#activeOrders.add(order);

            if (nextKey) {
                if (!this.#activeBySymbol.has(nextKey)) {
                    this.#activeBySymbol.set(nextKey, new Set());
                }

                this.#activeBySymbol.get(nextKey)!.add(order);
            }
        }
    }

    #detach(order: Order): void {
        const listener = this.#listeners.get(order);

        if (listener) {
            order.off('update', listener);
            this.#listeners.delete(order);
        }
    }
}

export function isActiveStatus(status: OrderStatus): boolean {
    return status === OrderStatus.Placed || status === OrderStatus.PartiallyFilled || status === OrderStatus.Canceling;
}

function normalizeClOrdId(value: ClOrdID | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSymbolKey(symbol: Symbol | null | undefined): string | null {
    if (typeof symbol !== 'string') {
        return null;
    }

    const trimmed = symbol.trim();

    if (trimmed.length === 0) {
        return null;
    }

    return trimmed.toUpperCase();
}
