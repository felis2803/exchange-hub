import { EventEmitter } from 'node:events';

import { diffKeys } from '../infra/diff.js';
import { isNewerByTimestamp, normalizeWsTs } from '../infra/time.js';

import type {
  AccountId,
  BaseEntity,
  DomainUpdate,
  Symbol as TradingSymbol,
  TimestampISO,
} from '../core/types.js';
import type { Side } from '../types.js';

type NumericField =
  | 'avgEntryPrice'
  | 'avgCostPrice'
  | 'bankruptPrice'
  | 'breakEvenPrice'
  | 'commission'
  | 'currentComm'
  | 'currentCost'
  | 'deleveragePercentile'
  | 'foreignNotional'
  | 'grossOpenCost'
  | 'grossOpenPremium'
  | 'homeNotional'
  | 'initMargin'
  | 'initMarginReq'
  | 'leverage'
  | 'liquidationPrice'
  | 'maintMargin'
  | 'maintMarginReq'
  | 'marginCallPrice'
  | 'markPrice'
  | 'markValue'
  | 'openOrderBuyCost'
  | 'openOrderBuyPremium'
  | 'openOrderBuyQty'
  | 'openOrderSellCost'
  | 'openOrderSellPremium'
  | 'openOrderSellQty'
  | 'openingQty'
  | 'posComm'
  | 'posCost'
  | 'posCost2'
  | 'posCross'
  | 'posLoss'
  | 'posMaint'
  | 'posMargin'
  | 'prevRealisedPnl'
  | 'prevUnrealisedPnl'
  | 'realisedCost'
  | 'realisedPnl'
  | 'rebalancedPnl'
  | 'riskLimit'
  | 'riskValue'
  | 'simpleCost'
  | 'simplePnl'
  | 'simplePnlPcnt'
  | 'simpleQty'
  | 'simpleValue'
  | 'unrealisedCost'
  | 'unrealisedPnl'
  | 'unrealisedPnlPcnt'
  | 'unrealisedRoePcnt';

type BooleanField = 'crossMargin';

type StringField = 'currency' | 'posState' | 'quoteCurrency' | 'underlying';

const NUMERIC_FIELDS: readonly NumericField[] = [
  'avgEntryPrice',
  'avgCostPrice',
  'bankruptPrice',
  'breakEvenPrice',
  'commission',
  'currentComm',
  'currentCost',
  'deleveragePercentile',
  'foreignNotional',
  'grossOpenCost',
  'grossOpenPremium',
  'homeNotional',
  'initMargin',
  'initMarginReq',
  'leverage',
  'liquidationPrice',
  'maintMargin',
  'maintMarginReq',
  'marginCallPrice',
  'markPrice',
  'markValue',
  'openOrderBuyCost',
  'openOrderBuyPremium',
  'openOrderBuyQty',
  'openOrderSellCost',
  'openOrderSellPremium',
  'openOrderSellQty',
  'openingQty',
  'posComm',
  'posCost',
  'posCost2',
  'posCross',
  'posLoss',
  'posMaint',
  'posMargin',
  'prevRealisedPnl',
  'prevUnrealisedPnl',
  'realisedCost',
  'realisedPnl',
  'rebalancedPnl',
  'riskLimit',
  'riskValue',
  'simpleCost',
  'simplePnl',
  'simplePnlPcnt',
  'simpleQty',
  'simpleValue',
  'unrealisedCost',
  'unrealisedPnl',
  'unrealisedPnlPcnt',
  'unrealisedRoePcnt',
];

const BOOLEAN_FIELDS: readonly BooleanField[] = ['crossMargin'];

const STRING_FIELDS: readonly StringField[] = [
  'currency',
  'posState',
  'quoteCurrency',
  'underlying',
];

export type PositionSnapshot = {
  accountId: AccountId;
  symbol: TradingSymbol;
  side: Side;
  size: number;
  currentQty: number;
  timestamp?: TimestampISO | null;
  currency?: string | null;
  underlying?: string | null;
  quoteCurrency?: string | null;
  leverage?: number | null;
  crossMargin?: boolean | null;
  deleveragePercentile?: number | null;
  commission?: number | null;
  initMarginReq?: number | null;
  maintMarginReq?: number | null;
  riskLimit?: number | null;
  riskValue?: number | null;
  avgEntryPrice?: number | null;
  avgCostPrice?: number | null;
  breakEvenPrice?: number | null;
  markPrice?: number | null;
  markValue?: number | null;
  liquidationPrice?: number | null;
  bankruptPrice?: number | null;
  marginCallPrice?: number | null;
  realisedPnl?: number | null;
  unrealisedPnl?: number | null;
  unrealisedPnlPcnt?: number | null;
  unrealisedRoePcnt?: number | null;
  simpleQty?: number | null;
  simpleCost?: number | null;
  simpleValue?: number | null;
  simplePnl?: number | null;
  simplePnlPcnt?: number | null;
  homeNotional?: number | null;
  foreignNotional?: number | null;
  grossOpenCost?: number | null;
  grossOpenPremium?: number | null;
  posCost?: number | null;
  posCost2?: number | null;
  posCross?: number | null;
  posLoss?: number | null;
  posMaint?: number | null;
  posMargin?: number | null;
  posComm?: number | null;
  currentCost?: number | null;
  currentComm?: number | null;
  realisedCost?: number | null;
  unrealisedCost?: number | null;
  openOrderBuyQty?: number | null;
  openOrderSellQty?: number | null;
  openOrderBuyCost?: number | null;
  openOrderSellCost?: number | null;
  openOrderBuyPremium?: number | null;
  openOrderSellPremium?: number | null;
  openingQty?: number | null;
  initMargin?: number | null;
  maintMargin?: number | null;
  posState?: string | null;
  rebalancedPnl?: number | null;
  prevRealisedPnl?: number | null;
  prevUnrealisedPnl?: number | null;
  isOpen?: boolean | null;
};

export type PositionUpdate = Partial<Omit<PositionSnapshot, 'accountId' | 'symbol'>>;

export type PositionUpdateReason = string | undefined;

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeNumeric(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function normalizeQty(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function normalizeSize(value: unknown): number | undefined {
  const numeric = normalizeQty(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, Math.abs(numeric));
}

function normalizeBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return Boolean(value);
}

function normalizeString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeTimestamp(value: unknown): TimestampISO | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = normalizeWsTs(value as any);

  if (!normalized) {
    return undefined;
  }

  return normalized;
}

function normalizeSide(side: unknown): Side | undefined {
  if (side === 'sell') {
    return 'sell';
  }

  if (side === 'buy') {
    return 'buy';
  }

  return undefined;
}

function resolveQuantity(
  prev: PositionSnapshot,
  update: PositionUpdate,
): { currentQty: number; size: number; side: Side } {
  const hasQty = hasOwn(update, 'currentQty');
  const hasSize = hasOwn(update, 'size');
  const hasSide = hasOwn(update, 'side');

  let currentQty = hasQty ? normalizeQty(update.currentQty) ?? 0 : prev.currentQty;
  let size = hasSize ? normalizeSize(update.size) ?? (hasQty ? Math.abs(currentQty) : prev.size) : prev.size;
  size = Math.max(0, Math.abs(size));

  let side: Side = hasSide ? normalizeSide(update.side) ?? prev.side : prev.side;

  if (hasQty) {
    if (!Number.isFinite(currentQty)) {
      currentQty = 0;
    }

    if (currentQty > 0) {
      side = 'buy';
      size = Math.abs(currentQty);
    } else if (currentQty < 0) {
      side = 'sell';
      size = Math.abs(currentQty);
    } else {
      size = hasSize ? size : 0;
      side = hasSide ? side : size > 0 ? prev.side : 'buy';
      currentQty = size === 0 ? 0 : side === 'sell' ? -size : size;
    }
  } else if (hasSize) {
    if (size === 0) {
      currentQty = 0;
      side = hasSide ? side : 'buy';
    } else {
      if (!hasSide) {
        side = prev.currentQty < 0 ? 'sell' : prev.currentQty > 0 ? 'buy' : prev.side;
      }

      currentQty = side === 'sell' ? -size : size;
    }
  } else if (hasSide) {
    if (size === 0) {
      currentQty = 0;
    } else {
      currentQty = side === 'sell' ? -size : size;
    }
  }

  if (!Number.isFinite(currentQty)) {
    currentQty = side === 'sell' ? -size : size;
  }

  if (!Number.isFinite(size)) {
    size = Math.abs(currentQty);
  }

  if (size === 0) {
    currentQty = 0;
    side = 'buy';
  }

  return { currentQty, size, side };
}

function sanitizeUpdate(update: PositionUpdate): PositionUpdate {
  const sanitized: PositionUpdate = {};

  if (hasOwn(update, 'timestamp')) {
    sanitized.timestamp = normalizeTimestamp(update.timestamp);
  }

  if (hasOwn(update, 'side')) {
    const nextSide = normalizeSide(update.side);
    if (nextSide) {
      sanitized.side = nextSide;
    }
  }

  if (hasOwn(update, 'currentQty')) {
    const qty = normalizeQty(update.currentQty);
    if (qty !== undefined) {
      sanitized.currentQty = qty;
    }
  }

  if (hasOwn(update, 'size')) {
    const size = normalizeSize(update.size);
    if (size !== undefined) {
      sanitized.size = size;
    }
  }

  for (const field of NUMERIC_FIELDS) {
    if (!hasOwn(update, field)) {
      continue;
    }

    sanitized[field] = normalizeNumeric(update[field]);
  }

  for (const field of BOOLEAN_FIELDS) {
    if (!hasOwn(update, field)) {
      continue;
    }

    sanitized[field] = normalizeBoolean(update[field]);
  }

  for (const field of STRING_FIELDS) {
    if (!hasOwn(update, field)) {
      continue;
    }

    sanitized[field] = normalizeString(update[field]);
  }

  return sanitized;
}

function normalizeSnapshot(snapshot: PositionSnapshot): PositionSnapshot {
  const base: PositionSnapshot = {
    accountId: snapshot.accountId,
    symbol: snapshot.symbol,
    side: normalizeSide(snapshot.side) ?? 'buy',
    size: Math.max(0, Math.abs(snapshot.size ?? 0)),
    currentQty: Number.isFinite(snapshot.currentQty) ? snapshot.currentQty : 0,
    timestamp: normalizeTimestamp(snapshot.timestamp) ?? undefined,
  };

  const merged: PositionSnapshot = { ...base };

  const quantity = resolveQuantity(base, snapshot);
  merged.currentQty = quantity.currentQty;
  merged.size = quantity.size;
  merged.side = quantity.side;

  for (const field of NUMERIC_FIELDS) {
    const value = normalizeNumeric(snapshot[field]);
    if (value !== undefined) {
      merged[field] = value;
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = normalizeBoolean(snapshot[field]);
    if (value !== undefined) {
      merged[field] = value;
    }
  }

  for (const field of STRING_FIELDS) {
    const value = normalizeString(snapshot[field]);
    if (value !== undefined) {
      merged[field] = value;
    }
  }

  merged.isOpen = merged.size > 0;

  return merged;
}

function mergeSnapshot(prev: PositionSnapshot, update: PositionUpdate): PositionSnapshot {
  const sanitized = sanitizeUpdate(update);
  const next: PositionSnapshot = { ...prev };

  if (hasOwn(sanitized, 'timestamp')) {
    next.timestamp = sanitized.timestamp ?? undefined;
  }

  for (const field of NUMERIC_FIELDS) {
    if (!hasOwn(sanitized, field)) {
      continue;
    }

    next[field] = sanitized[field];
  }

  for (const field of BOOLEAN_FIELDS) {
    if (!hasOwn(sanitized, field)) {
      continue;
    }

    next[field] = sanitized[field];
  }

  for (const field of STRING_FIELDS) {
    if (!hasOwn(sanitized, field)) {
      continue;
    }

    next[field] = sanitized[field];
  }

  const quantity = resolveQuantity(prev, sanitized);
  next.currentQty = quantity.currentQty;
  next.size = quantity.size;
  next.side = quantity.side;
  next.isOpen = next.size > 0;

  return next;
}

export class Position extends EventEmitter implements BaseEntity<PositionSnapshot> {
  #snapshot: PositionSnapshot;

  constructor(snapshot: PositionSnapshot) {
    super();

    this.#snapshot = normalizeSnapshot(snapshot);
  }

  get accountId(): AccountId {
    return this.#snapshot.accountId;
  }

  get symbol(): TradingSymbol {
    return this.#snapshot.symbol;
  }

  get side(): Side {
    return this.#snapshot.side;
  }

  get size(): number {
    return this.#snapshot.size;
  }

  get currentQty(): number {
    return this.#snapshot.currentQty;
  }

  get timestamp(): TimestampISO | null | undefined {
    return this.#snapshot.timestamp;
  }

  getSnapshot(): PositionSnapshot {
    return { ...this.#snapshot };
  }

  override on(
    event: 'update',
    listener: (
      next: PositionSnapshot,
      diff: DomainUpdate<PositionSnapshot>,
      reason?: PositionUpdateReason,
    ) => void,
  ): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override once(
    event: 'update',
    listener: (
      next: PositionSnapshot,
      diff: DomainUpdate<PositionSnapshot>,
      reason?: PositionUpdateReason,
    ) => void,
  ): this;
  override once(event: string | symbol, listener: (...args: any[]) => void): this;
  override once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  override off(
    event: 'update',
    listener: (
      next: PositionSnapshot,
      diff: DomainUpdate<PositionSnapshot>,
      reason?: PositionUpdateReason,
    ) => void,
  ): this;
  override off(event: string | symbol, listener: (...args: any[]) => void): this;
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  override emit(
    event: 'update',
    next: PositionSnapshot,
    diff: DomainUpdate<PositionSnapshot>,
    reason?: PositionUpdateReason,
  ): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  reset(snapshot: PositionSnapshot, reason?: PositionUpdateReason): boolean {
    if (snapshot.accountId !== this.accountId || snapshot.symbol !== this.symbol) {
      throw new Error('Position identity mismatch');
    }

    const prev = this.getSnapshot();
    const next = normalizeSnapshot(snapshot);
    const changed = diffKeys(prev, next);

    if (changed.length === 0) {
      return false;
    }

    this.#snapshot = next;

    const diff: DomainUpdate<PositionSnapshot> = { prev, next: { ...next }, changed };
    this.emit('update', this.getSnapshot(), diff, reason);

    return true;
  }

  update(
    update: PositionUpdate,
    reason?: PositionUpdateReason,
    options: { allowOlderTimestamp?: boolean } = {},
  ): boolean {
    const { allowOlderTimestamp = false } = options;
    const sanitized = sanitizeUpdate(update);

    if (!allowOlderTimestamp && hasOwn(sanitized, 'timestamp') && sanitized.timestamp) {
      if (this.timestamp && !isNewerByTimestamp(this.timestamp, sanitized.timestamp)) {
        return false;
      }
    }

    const prev = this.getSnapshot();
    const next = mergeSnapshot(this.#snapshot, sanitized);
    const changed = diffKeys(prev, next);

    if (changed.length === 0) {
      return false;
    }

    this.#snapshot = next;

    const diff: DomainUpdate<PositionSnapshot> = { prev, next: { ...next }, changed };
    this.emit('update', this.getSnapshot(), diff, reason);

    return true;
  }
}

export type PositionsViewKey = {
  key: string;
  accountId: AccountId;
  symbol: TradingSymbol;
};

export type PositionsViewEntry = PositionsViewKey & {
  position: Position;
};

export interface PositionsView {
  readonly size: number;
  get(accountId: AccountId, symbol: TradingSymbol): Position | undefined;
  has(accountId: AccountId, symbol: TradingSymbol): boolean;
  values(): IterableIterator<Position>;
  keys(): IterableIterator<PositionsViewKey>;
  entries(): IterableIterator<PositionsViewEntry>;
  byAccount(accountId: AccountId): IterableIterator<Position>;
  bySymbol(symbol: TradingSymbol): IterableIterator<Position>;
  active(): IterableIterator<Position>;
  toArray(): readonly Position[];
  activeArray(): readonly Position[];
  byAccountArray(accountId: AccountId): readonly Position[];
  bySymbolArray(symbol: TradingSymbol): readonly Position[];
  asMap(): ReadonlyMap<string, Position>;
}

type PositionUpdateListener = (
  position: Position,
  snapshot: PositionSnapshot,
  diff: DomainUpdate<PositionSnapshot>,
  reason?: PositionUpdateReason,
) => void;

type PositionRegistryOptions = {
  onUpdate?: PositionUpdateListener;
};

function normalizeAccountId(accountId: AccountId): AccountId {
  return String(accountId).trim();
}

function normalizeSymbol(symbol: TradingSymbol): TradingSymbol {
  return symbol.trim().toUpperCase();
}

export class PositionsRegistry {
  #byKey = new Map<string, Position>();
  #bySymbol = new Map<string, Set<Position>>();
  #byAccount = new Map<AccountId, Set<Position>>();
  #active = new Set<Position>();
  #listeners = new WeakMap<Position, (
    snapshot: PositionSnapshot,
    diff: DomainUpdate<PositionSnapshot>,
    reason?: PositionUpdateReason,
  ) => void>();
  #onUpdate?: PositionUpdateListener;
  #view: PositionsView;

  constructor(options: PositionRegistryOptions = {}) {
    this.#onUpdate = options.onUpdate;
    this.#view = this.#createView();
  }

  get size(): number {
    return this.#byKey.size;
  }

  #key(accountId: AccountId, symbol: TradingSymbol): string {
    return `${normalizeAccountId(accountId)}::${normalizeSymbol(symbol)}`;
  }

  #attach(position: Position): void {
    const listener = (
      snapshot: PositionSnapshot,
      diff: DomainUpdate<PositionSnapshot>,
      reason?: PositionUpdateReason,
    ) => {
      this.#refreshActive(position, snapshot);

      if (this.#onUpdate) {
        this.#onUpdate(position, snapshot, diff, reason);
      }
    };

    position.on('update', listener);
    this.#listeners.set(position, listener);
    this.#refreshActive(position, position.getSnapshot());
  }

  #detach(position: Position): void {
    const listener = this.#listeners.get(position);

    if (!listener) {
      return;
    }

    position.off('update', listener);
    this.#listeners.delete(position);
  }

  #index(position: Position): void {
    const accountId = normalizeAccountId(position.accountId);
    const symbol = normalizeSymbol(position.symbol);
    const key = this.#key(accountId, symbol);

    this.#byKey.set(key, position);

    if (!this.#bySymbol.has(symbol)) {
      this.#bySymbol.set(symbol, new Set());
    }

    this.#bySymbol.get(symbol)!.add(position);

    if (!this.#byAccount.has(accountId)) {
      this.#byAccount.set(accountId, new Set());
    }

    this.#byAccount.get(accountId)!.add(position);
    this.#refreshActive(position, position.getSnapshot());
  }

  #unindex(position: Position): void {
    const accountId = normalizeAccountId(position.accountId);
    const symbol = normalizeSymbol(position.symbol);
    const key = this.#key(accountId, symbol);

    this.#byKey.delete(key);

    const symbolSet = this.#bySymbol.get(symbol);
    symbolSet?.delete(position);
    if (symbolSet && symbolSet.size === 0) {
      this.#bySymbol.delete(symbol);
    }

    const accountSet = this.#byAccount.get(accountId);
    accountSet?.delete(position);
    if (accountSet && accountSet.size === 0) {
      this.#byAccount.delete(accountId);
    }

    this.#active.delete(position);
  }

  #refreshActive(position: Position, snapshot: PositionSnapshot): void {
    if (snapshot.size > 0) {
      this.#active.add(position);
    } else {
      this.#active.delete(position);
    }
  }

  #positionsIterator(source: Iterable<Position>): IterableIterator<Position> {
    return (function* (items: Iterable<Position>): IterableIterator<Position> {
      for (const position of items) {
        yield position;
      }
    })(source);
  }

  #keysIterator(): IterableIterator<PositionsViewKey> {
    const self = this;
    return (function* (): IterableIterator<PositionsViewKey> {
      for (const key of self.#byKey.keys()) {
        const [accountId, symbol] = key.split('::');
        yield {
          key,
          accountId: accountId as AccountId,
          symbol: symbol as TradingSymbol,
        };
      }
    })();
  }

  #entriesIterator(): IterableIterator<PositionsViewEntry> {
    const self = this;
    return (function* (): IterableIterator<PositionsViewEntry> {
      for (const [key, position] of self.#byKey.entries()) {
        const [accountId, symbol] = key.split('::');
        yield {
          key,
          accountId: accountId as AccountId,
          symbol: symbol as TradingSymbol,
          position,
        };
      }
    })();
  }

  #createView(): PositionsView {
    const view = {
      get: (accountId, symbol) => this.get(accountId, symbol),
      has: (accountId, symbol) => this.#byKey.has(this.#key(accountId, symbol)),
      values: () => this.#positionsIterator(this.#byKey.values()),
      keys: () => this.#keysIterator(),
      entries: () => this.#entriesIterator(),
      byAccount: (accountId) =>
        this.#positionsIterator(
          this.#byAccount.get(normalizeAccountId(accountId)) ?? [],
        ),
      bySymbol: (symbol) =>
        this.#positionsIterator(this.#bySymbol.get(normalizeSymbol(symbol)) ?? []),
      active: () => this.#positionsIterator(this.#active),
      toArray: () => this.values(),
      activeArray: () => this.active,
      byAccountArray: (accountId) => this.byAccount(accountId),
      bySymbolArray: (symbol) => this.bySymbol(symbol),
      asMap: () => new Map(this.#byKey),
    } satisfies Omit<PositionsView, 'size'>;

    Object.defineProperty(view, 'size', {
      get: () => this.size,
    });

    return view as unknown as PositionsView;
  }

  add(position: Position): void {
    const existing = this.get(position.accountId, position.symbol);

    if (existing && existing !== position) {
      this.remove(existing);
    }

    this.#index(position);
    this.#attach(position);
  }

  get(accountId: AccountId, symbol: TradingSymbol): Position | undefined {
    return this.#byKey.get(this.#key(accountId, symbol));
  }

  remove(position: Position): void {
    this.#detach(position);
    this.#unindex(position);
  }

  removeByKey(accountId: AccountId, symbol: TradingSymbol): Position | undefined {
    const existing = this.get(accountId, symbol);

    if (!existing) {
      return undefined;
    }

    this.remove(existing);
    return existing;
  }

  asReadonly(): PositionsView {
    return this.#view;
  }

  values(): readonly Position[] {
    return Array.from(this.#byKey.values());
  }

  byAccount(accountId: AccountId): readonly Position[] {
    return Array.from(this.#byAccount.get(normalizeAccountId(accountId)) ?? []);
  }

  bySymbol(symbol: TradingSymbol): readonly Position[] {
    return Array.from(this.#bySymbol.get(normalizeSymbol(symbol)) ?? []);
  }

  get active(): readonly Position[] {
    return Array.from(this.#active);
  }

  clear(): void {
    for (const position of this.#byKey.values()) {
      this.#detach(position);
    }

    this.#byKey.clear();
    this.#bySymbol.clear();
    this.#byAccount.clear();
    this.#active.clear();
  }
}

