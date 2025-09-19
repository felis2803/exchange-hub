import { BitMexTransport } from './transport.js';
import { channelMessageHandlers } from './channelMessageHandlers/index.js';
import { isChannelMessage, isSubscribeMessage, isWelcomeMessage } from './utils.js';
import { L2_CHANNEL, L2_MAX_DEPTH_HINT } from './constants.js';
import { markOrderChannelAwaitingSnapshot } from './channels/order.js';
import { createBitmexRestOrders, type BitmexRestOrders } from './rest/orders.js';
import { BitmexRestClient } from './rest/request.js';
import { mapBitmexOrderStatus, mapToBitmexCreateOrderPayload } from './mappers/order.js';

import { BaseCore } from '../BaseCore.js';
import { getUnifiedSymbolAliases, mapSymbolNativeToUni } from '../../utils/symbolMapping.js';
import { Instrument } from '../../domain/instrument.js';
import { OrderStatus } from '../../domain/order.js';
import type { OrderInit } from '../../domain/order.js';
import { createLogger } from '../../infra/logger.js';
import type { Settings, Side } from '../../types.js';
import type { ExchangeHub } from '../../ExchangeHub.js';
import type { CreateOrderParams, CreateOrderParamsBase } from '../exchange-hub.js';
import type {
  BitMexChannel,
  BitMexChannelMessage,
  BitMexOrder,
  BitMexSubscribeMessage,
  BitMexWelcomeMessage,
} from './types.js';

export class BitMex extends BaseCore<'BitMex'> {
  #log = createLogger('bitmex:core');
  #settings: Settings;
  #transport: BitMexTransport;
  #restClient: BitmexRestClient;
  #restOrders: BitmexRestOrders;
  #symbolMappingEnabled: boolean;
  #instruments = new Map<string, Instrument>();
  #instrumentsByNative = new Map<string, Instrument>();
  #instrumentKeys = new WeakMap<Instrument, Set<string>>();

  constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
    super(shell, settings);

    this.#settings = settings;
    this.#symbolMappingEnabled = settings.symbolMappingEnabled ?? true;
    this.#transport = new BitMexTransport(settings.isTest ?? false, (message) =>
      this.#handleMessage(message),
    );
    this.#restClient = new BitmexRestClient({
      isTest: this.isTest,
      apiKey: settings.apiKey,
      apiSecret: settings.apiSec,
    });
    this.#restOrders = createBitmexRestOrders(this.#restClient);
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

  buy(params: CreateOrderParamsBase): Promise<BitMexOrder> {
    return this.#placeOrder({ ...params, side: 'buy' });
  }

  sell(params: CreateOrderParamsBase): Promise<BitMexOrder> {
    return this.#placeOrder({ ...params, side: 'sell' });
  }

  async #placeOrder(params: CreateOrderParams): Promise<BitMexOrder> {
    const payload = mapToBitmexCreateOrderPayload(params);
    const response = await this.#restOrders.createOrder(payload);
    this.#syncRestOrder(response, params.side, params.clientOrderId);
    return response;
  }

  #syncRestOrder(order: BitMexOrder, side: Side, clientOrderId?: string): void {
    const orderId = typeof order.orderID === 'string' ? order.orderID : undefined;
    const symbol = typeof order.symbol === 'string' ? order.symbol.trim() : '';

    if (!orderId || !symbol) {
      return;
    }

    const store = this.shell.orders;
    const existing = store.getByOrderId(orderId);

    const leavesQty = isFiniteNumber(order.leavesQty) ? order.leavesQty : null;
    const cumQty = isFiniteNumber(order.cumQty) ? order.cumQty : null;

    const status =
      mapBitmexOrderStatus({
        ordStatus: order.ordStatus,
        execType: order.execType,
        leavesQty,
        cumQty,
        previousStatus: existing?.status ?? null,
      }) ?? OrderStatus.Placed;

    const init = {
      clOrdId: normalizeClOrdId(order.clOrdID ?? clientOrderId),
      symbol,
      status,
      side,
      type: order.ordType,
      timeInForce: order.timeInForce,
      execInst: order.execInst,
      price: isFiniteNumber(order.price) ? order.price : undefined,
      stopPrice: isFiniteNumber(order.stopPx) ? order.stopPx : undefined,
      qty: isFiniteNumber(order.orderQty) ? order.orderQty : undefined,
      leavesQty: leavesQty ?? undefined,
      filledQty: cumQty ?? undefined,
      avgFillPrice: isFiniteNumber(order.avgPx) ? order.avgPx : undefined,
    } satisfies Omit<OrderInit, 'orderId'>;

    if (!existing) {
      store.create(orderId, init);
      return;
    }

    existing.applyUpdate(
      {
        clOrdId: init.clOrdId,
        symbol,
        side,
        type: init.type,
        timeInForce: init.timeInForce,
        execInst: init.execInst,
        price: init.price,
        stopPrice: init.stopPrice,
        qty: init.qty,
        leavesQty: init.leavesQty,
        cumQty: init.filledQty,
        avgPx: init.avgFillPrice,
        status,
      },
      { reason: 'replace' },
    );
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

function normalizeClOrdId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
