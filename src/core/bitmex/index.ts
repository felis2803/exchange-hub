import { BitMexTransport } from './transport.js';
import { channelMessageHandlers } from './channelMessageHandlers/index.js';
import { isChannelMessage, isSubscribeMessage, isWelcomeMessage } from './utils.js';
import { L2_CHANNEL, L2_MAX_DEPTH_HINT } from './constants.js';
import { markOrderChannelAwaitingSnapshot } from './channels/order.js';
import { BitmexRestClient } from './rest/request.js';
import { createOrder, getOrderByClOrdId, BITMEX_CREATE_ORDER_TIMEOUT_MS } from './rest/orders.js';
import { mapBitmexOrderStatus, mapPreparedOrderToCreatePayload } from './mappers/order.js';

import type { CreateOrderPayload } from './rest/orders.js';
import { BaseCore } from '../BaseCore.js';
import { getUnifiedSymbolAliases, mapSymbolNativeToUni } from '../../utils/symbolMapping.js';
import { Instrument } from '../../domain/instrument.js';
import type { Order, OrderStatus, type OrderInit, type OrderUpdate } from '../../domain/order.js';
import { createLogger } from '../../infra/logger.js';
import { OrderRejectedError, TimeoutError, ValidationError } from '../../infra/errors.js';
import type { PreparedPlaceInput } from '../../infra/validation.js';
import type { Settings } from '../../types.js';
import type { ExchangeHub } from '../../ExchangeHub.js';
import type {
    BitMexChannel,
    BitMexChannelMessage,
    BitMexSubscribeMessage,
    BitMexWelcomeMessage,
    BitMexOrder,
} from './types.js';

export class BitMex extends BaseCore<'BitMex'> {
    #log = createLogger('bitmex:core');
    #settings: Settings;
    #transport: BitMexTransport;
    #rest: BitmexRestClient;
    #symbolMappingEnabled: boolean;
    #instruments = new Map<string, Instrument>();
    #instrumentsByNative = new Map<string, Instrument>();
    #instrumentKeys = new WeakMap<Instrument, Set<string>>();

    constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
        super(shell, settings);

        this.#settings = settings;
        this.#symbolMappingEnabled = settings.symbolMappingEnabled ?? true;
        this.#transport = new BitMexTransport(settings.isTest ?? false, message => this.#handleMessage(message));
        this.#rest = new BitmexRestClient({
            isTest: settings.isTest ?? false,
            apiKey: settings.apiKey,
            apiSecret: settings.apiSec,
        });
    }

    override get instruments(): Map<string, Instrument> {
        return this.#instruments;
    }

    get symbolMappingEnabled(): boolean {
        return this.#symbolMappingEnabled;
    }

    resetInstrumentCache(): void {
        this.#instruments.clear();
        this.#instrumentsByNative.clear();
        this.#instrumentKeys = new WeakMap();
    }

    registerInstrument(instrument: Instrument): void {
        if (!(instrument instanceof Instrument)) {
            throw new TypeError('Expected Instrument instance');
        }

        const existing = this.#instrumentsByNative.get(instrument.symbolNative);

        if (existing && existing !== instrument) {
            this.#removeInstrumentKeys(existing);
        }

        this.#instrumentsByNative.set(instrument.symbolNative, instrument);
        this.#registerInstrumentKeys(instrument);
    }

    getInstrumentByNative(symbol: string): Instrument | undefined {
        return this.#instrumentsByNative.get(symbol);
    }

    resolveInstrument(symbol: string): Instrument | undefined {
        if (typeof symbol !== 'string') {
            return undefined;
        }

        const normalized = symbol.trim();

        if (!normalized) {
            return undefined;
        }

        const direct =
            this.getInstrumentByNative(normalized) ??
            this.instruments.get(normalized) ??
            this.instruments.get(normalized.toLowerCase()) ??
            this.instruments.get(normalized.toUpperCase());

        if (direct) {
            return direct;
        }

        const unified = mapSymbolNativeToUni(normalized, { enabled: this.#symbolMappingEnabled });

        if (!unified) {
            return undefined;
        }

        return (
            this.instruments.get(unified) ??
            this.instruments.get(unified.toLowerCase()) ??
            this.instruments.get(unified.toUpperCase())
        );
    }

    refreshInstrumentKeys(instrument: Instrument): void {
        this.#registerInstrumentKeys(instrument);
    }

    removeInstrument(symbol: string): void {
        const instrument = this.#instrumentsByNative.get(symbol);

        if (!instrument) {
            return;
        }

        this.#instrumentsByNative.delete(symbol);
        this.#removeInstrumentKeys(instrument);
    }

    buy(prepared: PreparedPlaceInput): Promise<Order> {
        if (prepared.side !== 'buy') {
            throw new ValidationError('BitMEX buy() expects payload with side "buy"', {
                details: { side: prepared.side },
            });
        }

        return this.#submitOrder(prepared);
    }

    sell(prepared: PreparedPlaceInput): Promise<Order> {
        if (prepared.side !== 'sell') {
            throw new ValidationError('BitMEX sell() expects payload with side "sell"', {
                details: { side: prepared.side },
            });
        }

        return this.#submitOrder(prepared);
    }

    #registerInstrumentKeys(instrument: Instrument): void {
        const existingKeys = this.#instrumentKeys.get(instrument);

        if (existingKeys) {
            for (const key of existingKeys) {
                this.#instruments.delete(key);
            }

            existingKeys.clear();
        }

        const keys = existingKeys ?? new Set<string>();

        const registerKey = (key: string | undefined) => {
            if (!key) {
                return;
            }

            const variants = new Set<string>([key, key.toLowerCase(), key.toUpperCase()]);

            for (const variant of variants) {
                keys.add(variant);
                this.#instruments.set(variant, instrument);
            }
        };

        registerKey(instrument.symbolNative);

        if (this.#symbolMappingEnabled) {
            for (const alias of getUnifiedSymbolAliases(instrument.symbolUni)) {
                registerKey(alias);
            }
        }

        this.#instrumentKeys.set(instrument, keys);
    }

    #removeInstrumentKeys(instrument: Instrument): void {
        const keys = this.#instrumentKeys.get(instrument);

        if (!keys) {
            return;
        }

        for (const key of keys) {
            this.#instruments.delete(key);
        }

        this.#instrumentKeys.delete(instrument);
    }

    #submitOrder(prepared: PreparedPlaceInput): Promise<Order> {
        let payload: CreateOrderPayload;

        try {
            payload = mapPreparedOrderToCreatePayload(prepared);
        } catch (error) {
            return Promise.reject(error);
        }

        const store = this.shell.orders;

        const inflight = store.getInflightByClOrdId(payload.clOrdID);

        if (inflight) {
            return inflight;
        }

        const existing = store.getByClOrdId(payload.clOrdID);

        if (existing) {
            return Promise.resolve(existing);
        }

        const startedAt = Date.now();
        const createOrderRetries = 1;
        const createOrderMaxAttempts = createOrderRetries + 1;
        const orderPromise = (async () => {
            try {
                const restOrder = await createOrder(this.#rest, payload, {
                    timeoutMs: BITMEX_CREATE_ORDER_TIMEOUT_MS,
                    retries: createOrderRetries,
                    logger: this.#log,
                });

                return this.#upsertOrderFromRest(restOrder);
            } catch (error) {
                if (shouldReconcileCreateOrderError(error)) {
                    const existing = store.getByClOrdId(payload.clOrdID);

                    if (existing) {
                        this.#log.info('BitMEX createOrder error but order already present for %s', payload.clOrdID, {
                            clOrdID: payload.clOrdID,
                            symbol: payload.symbol,
                            errorName: error instanceof Error ? error.name : typeof error,
                            attemptCount: createOrderMaxAttempts,
                            maxAttempts: createOrderMaxAttempts,
                            code:
                                error instanceof OrderRejectedError || error instanceof TimeoutError
                                    ? error.code
                                    : undefined,
                        });

                        return existing;
                    }

                    try {
                        this.#log.warn('BitMEX createOrder failed for %s, reconciling via GET', payload.clOrdID, {
                            clOrdID: payload.clOrdID,
                            symbol: payload.symbol,
                            errorName: error instanceof Error ? error.name : typeof error,
                            attemptCount: createOrderMaxAttempts,
                            maxAttempts: createOrderMaxAttempts,
                        });

                        const reconciled = await this.#reconcileOrderByClOrdId(payload.clOrdID);

                        if (reconciled) {
                            // prettier-ignore
                            this.#log.info(
                'BitMEX reconcile succeeded for %s',
                payload.clOrdID,
                {
                  clOrdID: payload.clOrdID,
                  symbol: payload.symbol,
                  latencyMs: Date.now() - startedAt,
                  attemptCount: createOrderMaxAttempts,
                  maxAttempts: createOrderMaxAttempts,
                },
              );

                            return reconciled;
                        }

                        // prettier-ignore
                        this.#log.error(
              'BitMEX reconcile returned no order for %s',
              payload.clOrdID,
              {
                clOrdID: payload.clOrdID,
                symbol: payload.symbol,
                attemptCount: createOrderMaxAttempts,
                maxAttempts: createOrderMaxAttempts,
              },
            );
                    } catch (reconcileError) {
                        const message =
                            reconcileError instanceof Error ? reconcileError.message : String(reconcileError);

                        // prettier-ignore
                        this.#log.error(
              'BitMEX reconcile failed for %s: %s',
              payload.clOrdID,
              message,
              {
                clOrdID: payload.clOrdID,
                symbol: payload.symbol,
                errorName:
                  reconcileError instanceof Error ? reconcileError.name : typeof reconcileError,
                attemptCount: createOrderMaxAttempts,
                maxAttempts: createOrderMaxAttempts,
              },
            );
                    }
                }

                throw error;
            } finally {
                store.clearInflight(payload.clOrdID);
            }
        })();

        store.registerInflight(payload.clOrdID, orderPromise);

        return orderPromise;
    }

    async #reconcileOrderByClOrdId(clOrdId: string): Promise<Order | undefined> {
        const restOrder = await getOrderByClOrdId(this.#rest, clOrdId, {
            timeoutMs: BITMEX_CREATE_ORDER_TIMEOUT_MS,
            logger: this.#log,
        });

        if (!restOrder) {
            return undefined;
        }

        return this.#upsertOrderFromRest(restOrder);
    }

    #upsertOrderFromRest(row: BitMexOrder): Order {
        const store = this.shell.orders;
        const orderId = normalizeId(row.orderID);

        if (!orderId) {
            throw new ValidationError('BitMEX createOrder response missing orderID', {
                details: { clOrdID: row.clOrdID, symbol: row.symbol },
            });
        }

        const clOrdId = normalizeId(row.clOrdID);
        const order = store.resolve(orderId, clOrdId);

        const leavesQty = normalizeNumber(row.leavesQty);
        const cumQty = normalizeNumber(row.cumQty);

        const status =
            mapBitmexOrderStatus({
                ordStatus: row.ordStatus,
                execType: row.execType,
                leavesQty: leavesQty ?? null,
                cumQty: cumQty ?? null,
                previousStatus: order?.status ?? null,
            }) ??
            order?.status ??
            OrderStatus.Placed;

        const update: OrderUpdate = { status };

        if (clOrdId) {
            update.clOrdId = clOrdId;
        }

        const symbol = normalizeSymbol(row.symbol);

        if (symbol) {
            update.symbol = symbol;
        }

        const side = normalizeSide(row.side);

        if (side) {
            update.side = side;
        }

        const ordType = normalizeString(row.ordType);

        if (ordType) {
            update.type = ordType;
        }

        const timeInForce = normalizeString(row.timeInForce);

        if (timeInForce) {
            update.timeInForce = timeInForce;
        }

        const execInst = normalizeString(row.execInst);

        if (execInst) {
            update.execInst = execInst;
        }

        const price = normalizeNumber(row.price);

        if (price !== undefined) {
            update.price = price;
        }

        const stopPx = normalizeNumber(row.stopPx);

        if (stopPx !== undefined) {
            update.stopPrice = stopPx;
        }

        const qty = normalizeNumber(row.orderQty);

        if (qty !== undefined) {
            update.qty = qty;
        }

        if (leavesQty !== undefined) {
            update.leavesQty = leavesQty;
        }

        if (cumQty !== undefined) {
            update.cumQty = cumQty;
        }

        const avgPx = normalizeNumber(row.avgPx);

        if (avgPx !== undefined) {
            update.avgPx = avgPx;
        }

        const text = normalizeString(row.text);

        if (text) {
            update.text = text;
        }

        const lastUpdateTs = normalizeTimestampMs(row.transactTime ?? row.timestamp);

        if (lastUpdateTs !== null) {
            update.lastUpdateTs = lastUpdateTs;
        }

        if (order) {
            order.applyUpdate(update);

            return order;
        }

        const init: OrderInit = {
            orderId,
            status,
            clOrdId: clOrdId ?? undefined,
            symbol: update.symbol,
            side: update.side,
            type: update.type,
            timeInForce: update.timeInForce,
            execInst: update.execInst,
            price: update.price,
            stopPrice: update.stopPrice,
            qty: update.qty,
            leavesQty: update.leavesQty,
            filledQty: update.cumQty,
            avgFillPrice: update.avgPx,
            text: update.text,
            lastUpdateTs: update.lastUpdateTs,
            submittedAt: update.lastUpdateTs,
        };

        return store.create(orderId, init);
    }

    async connect(): Promise<void> {
        await this.#transport.connect(this.#settings.apiKey, this.#settings.apiSec);
    }

    async disconnect(): Promise<void> {
        await this.#transport.disconnect();
    }

    override resubscribeOrderBook(symbol: string): void {
        const normalized = typeof symbol === 'string' ? symbol.trim() : '';

        if (!normalized) {
            return;
        }

        const channelPrefix = L2_MAX_DEPTH_HINT > 0 ? `${L2_CHANNEL}_${L2_MAX_DEPTH_HINT}` : L2_CHANNEL;
        const channel = `${channelPrefix}:${normalized}`;

        this.#log.warn('BitMEX orderBookL2 resubscribe requested for %s', normalized);

        this.#transport.send({ op: 'unsubscribe', args: [channel] });
        this.#transport.send({ op: 'subscribe', args: [channel] });
    }

    #handleMessage(message: unknown) {
        if (isChannelMessage(message)) {
            return this.#handleChannelMessage(message);
        }

        if (isSubscribeMessage(message)) {
            return this.#handleSubscribeMessage(message);
        }

        if (isWelcomeMessage(message)) {
            return this.#handleWelcomeMessage(message);
        }

        console.warn(message);
        throw new Error('Unknown message');
    }

    #handleWelcomeMessage(_message: BitMexWelcomeMessage) {}

    #handleSubscribeMessage(message: BitMexSubscribeMessage) {
        if (!message.success) {
            return;
        }

        const requested = new Set(message.request?.args ?? []);

        if (message.subscribe === 'order' || requested.has('order')) {
            markOrderChannelAwaitingSnapshot(this);
        }
    }

    #handleChannelMessage<Channel extends BitMexChannel>(message: BitMexChannelMessage<Channel>) {
        const { table, action, data } = message;

        channelMessageHandlers[table][action](this, data);
    }
}

function normalizeId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSymbol(value: unknown): string | null {
    return normalizeId(value);
}

function normalizeSide(value: unknown): 'buy' | 'sell' | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'buy' || normalized === 'sell') {
        return normalized as 'buy' | 'sell';
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

function normalizeNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }

    return value;
}

function normalizeTimestampMs(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);

        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function shouldReconcileCreateOrderError(error: unknown): boolean {
    if (error instanceof TimeoutError) {
        return true;
    }

    if (error instanceof OrderRejectedError) {
        return error.httpStatus === 409;
    }

    return false;
}
