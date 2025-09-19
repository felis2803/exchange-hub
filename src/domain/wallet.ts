import { EventEmitter } from 'node:events';

import { diffKeys } from '../infra/diff.js';
import { isNewerByTimestamp } from '../infra/time.js';

import type { AccountId, BaseEntity, DomainUpdate, TimestampISO } from '../core/types.js';

export type WalletBalanceValue = number | null;

export type WalletBalanceSnapshot = {
  currency: string;
  amount?: WalletBalanceValue;
  pendingCredit?: WalletBalanceValue;
  pendingDebit?: WalletBalanceValue;
  confirmedDebit?: WalletBalanceValue;
  transferIn?: WalletBalanceValue;
  transferOut?: WalletBalanceValue;
  deposited?: WalletBalanceValue;
  withdrawn?: WalletBalanceValue;
  timestamp?: TimestampISO;
};

export type WalletSnapshot = {
  accountId: AccountId;
  balances: Record<string, WalletBalanceSnapshot>;
  updatedAt?: TimestampISO;
};

export type WalletBalanceUpdate = Partial<Omit<WalletBalanceSnapshot, 'currency'>>;

export type WalletBalanceInput = WalletBalanceUpdate & { currency: string };

export type WalletApplyOptions = {
  reason?: string;
  reset?: boolean;
};

export class Wallet extends EventEmitter implements BaseEntity<WalletSnapshot> {
  #accountId: AccountId;
  #balances: Map<string, WalletBalanceSnapshot> = new Map();
  #updatedAt?: TimestampISO;

  constructor(accountId: AccountId) {
    super();
    this.#accountId = accountId;
  }

  get accountId(): AccountId {
    return this.#accountId;
  }

  getSnapshot(): WalletSnapshot {
    return this.#buildSnapshot(this.#balances, this.#updatedAt);
  }

  apply(updates: WalletBalanceInput[], options: WalletApplyOptions = {}): DomainUpdate<WalletSnapshot> | null {
    const { reset = false, reason } = options;

    if (!Array.isArray(updates) || (updates.length === 0 && !reset)) {
      return null;
    }

    const prevSnapshot = this.getSnapshot();
    const balances = reset ? new Map<string, WalletBalanceSnapshot>() : new Map(this.#balances);

    for (const update of updates) {
      if (!update || typeof update.currency !== 'string') {
        continue;
      }

      const currencyKey = Wallet.#normalizeCurrencyKey(update.currency);
      if (!currencyKey) {
        continue;
      }

      const prevEntry = balances.get(currencyKey);
      const fields = Wallet.#omitCurrency(update);
      const nextEntry = prevEntry && !reset ? { ...prevEntry } : { currency: update.currency };

      let entryChanged = reset || !prevEntry || prevEntry.currency !== update.currency;

      const nextTimestamp = fields.timestamp;
      const prevTimestamp = prevEntry?.timestamp;

      if (
        !reset &&
        prevEntry &&
        prevTimestamp &&
        nextTimestamp &&
        !isNewerByTimestamp(prevTimestamp, nextTimestamp)
      ) {
        continue;
      }

      for (const [key, value] of Object.entries(fields) as [
        keyof WalletBalanceUpdate,
        WalletBalanceUpdate[keyof WalletBalanceUpdate],
      ][]) {
        if (value === undefined) {
          continue;
        }

        const current = (nextEntry as Record<string, unknown>)[key];

        if (value === null) {
          if (current !== null) {
            (nextEntry as Record<string, unknown>)[key] = null;
            entryChanged = true;
          }
          continue;
        }

        if (!Object.is(current, value)) {
          (nextEntry as Record<string, unknown>)[key] = value;
          entryChanged = true;
        }
      }

      if (!entryChanged) {
        continue;
      }

      balances.set(currencyKey, nextEntry);
    }

    const nextUpdatedAt = this.#calculateUpdatedAt(balances);
    const nextSnapshot = this.#buildSnapshot(balances, nextUpdatedAt);
    const changed = diffKeys(prevSnapshot, nextSnapshot);

    if (changed.length === 0) {
      return null;
    }

    this.#balances = balances;
    this.#updatedAt = nextUpdatedAt;

    const diff: DomainUpdate<WalletSnapshot> = { prev: prevSnapshot, next: nextSnapshot, changed };
    this.emit('update', nextSnapshot, diff, reason);

    return diff;
  }

  removeCurrencies(currencies: string[], reason?: string): DomainUpdate<WalletSnapshot> | null {
    if (!Array.isArray(currencies) || currencies.length === 0) {
      return null;
    }

    const prevSnapshot = this.getSnapshot();
    const balances = new Map(this.#balances);
    let mutated = false;

    for (const currency of currencies) {
      const currencyKey = Wallet.#normalizeCurrencyKey(currency);
      if (!currencyKey) {
        continue;
      }

      if (balances.delete(currencyKey)) {
        mutated = true;
      }
    }

    if (!mutated) {
      return null;
    }

    const nextUpdatedAt = this.#calculateUpdatedAt(balances);
    const nextSnapshot = this.#buildSnapshot(balances, nextUpdatedAt);
    const changed = diffKeys(prevSnapshot, nextSnapshot);

    if (changed.length === 0) {
      return null;
    }

    this.#balances = balances;
    this.#updatedAt = nextUpdatedAt;

    const diff: DomainUpdate<WalletSnapshot> = { prev: prevSnapshot, next: nextSnapshot, changed };
    this.emit('update', nextSnapshot, diff, reason);

    return diff;
  }

  override on(
    event: 'update',
    listener: (next: WalletSnapshot, diff: DomainUpdate<WalletSnapshot>, reason?: string) => void,
  ): this {
    return super.on(event, listener);
  }

  override off(
    event: 'update',
    listener: (next: WalletSnapshot, diff: DomainUpdate<WalletSnapshot>, reason?: string) => void,
  ): this {
    return super.off(event, listener);
  }

  static #normalizeCurrencyKey(currency: string): string {
    if (typeof currency !== 'string') {
      return '';
    }

    const trimmed = currency.trim();
    return trimmed.toLowerCase();
  }

  static #omitCurrency(update: WalletBalanceInput): WalletBalanceUpdate {
    const { currency: _currency, ...rest } = update;
    return rest;
  }

  #calculateUpdatedAt(balances: Map<string, WalletBalanceSnapshot>): TimestampISO | undefined {
    let latest: TimestampISO | undefined;

    for (const entry of balances.values()) {
      const ts = entry.timestamp;
      if (!ts) {
        continue;
      }

      if (!latest || isNewerByTimestamp(latest, ts)) {
        latest = ts;
      }
    }

    return latest;
  }

  #buildSnapshot(
    balances: Map<string, WalletBalanceSnapshot>,
    updatedAt?: TimestampISO,
  ): WalletSnapshot {
    const entries = Array.from(balances.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const normalizedBalances: Record<string, WalletBalanceSnapshot> = {};

    for (const [key, entry] of entries) {
      normalizedBalances[key] = { ...entry };
    }

    return {
      accountId: this.#accountId,
      balances: normalizedBalances,
      ...(updatedAt ? { updatedAt } : {}),
    };
  }
}
