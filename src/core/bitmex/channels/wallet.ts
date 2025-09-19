import { createLogger, LOG_TAGS } from '../../../infra/logger.js';
import { incrementCounter, observeHistogram } from '../../../infra/metrics.js';
import { METRICS } from '../../../infra/metrics-private.js';
import { normalizeWsTs, parseIsoTs } from '../../../infra/time.js';

import type { Wallet, WalletBalanceInput } from '../../../domain/wallet.js';
import type { PrivateLabels } from '../../../infra/metrics-private.js';
import type { BitMex } from '../index.js';
import type { BitMexWallet } from '../types.js';

const log = createLogger('bitmex:wallet');
const BASE_TAGS = [LOG_TAGS.ws, LOG_TAGS.private, LOG_TAGS.wallet] as const;

export function handleWalletPartial(core: BitMex, rows: BitMexWallet[]): void {
  processWalletRows(core, rows, {
    reset: true,
    action: 'partial',
    resolveReason: ({ existed }) => (existed ? 'ws:resync' : 'ws:partial'),
  });
}

export function handleWalletInsert(core: BitMex, rows: BitMexWallet[]): void {
  processWalletRows(core, rows, {
    reset: false,
    action: 'insert',
    resolveReason: () => 'ws:insert',
  });
}

export function handleWalletUpdate(core: BitMex, rows: BitMexWallet[]): void {
  processWalletRows(core, rows, {
    reset: false,
    action: 'update',
    resolveReason: () => 'ws:update',
  });
}

export function handleWalletDelete(core: BitMex, rows: BitMexWallet[]): void {
  const normalized = normalizeWalletRows(rows);
  if (normalized.length === 0) {
    return;
  }

  const grouped = new Map<string, Set<string>>();

  for (const row of normalized) {
    let currencies = grouped.get(row.accountId);
    if (!currencies) {
      currencies = new Set();
      grouped.set(row.accountId, currencies);
    }

    currencies.add(row.currencyDisplay);
  }

  if (grouped.size === 0) {
    return;
  }

  for (const [accountId, currencies] of grouped) {
    const wallet = core.shell.getWallet(accountId);
    if (!wallet) {
      continue;
    }

    const diff = wallet.removeCurrencies(Array.from(currencies), 'ws:delete');

    if (!diff) {
      continue;
    }

    recordMetrics(core, diff.next.updatedAt);
    logWalletUpdate({
      accountId,
      existed: true,
      action: 'delete',
      reason: 'ws:delete',
      changed: diff.changed,
      updatedAt: diff.next.updatedAt,
    });
  }
}

type ProcessOptions = {
  reset: boolean;
  action: 'partial' | 'insert' | 'update';
  resolveReason: (context: { existed: boolean }) => string;
};

type NormalizedWalletRow = {
  accountId: string;
  currencyKey: string;
  currencyDisplay: string;
  update: WalletBalanceInput;
  timestampMs?: number;
};

type WalletBalanceUpdate = Omit<WalletBalanceInput, 'currency'>;

function processWalletRows(core: BitMex, rows: BitMexWallet[], options: ProcessOptions): void {
  const normalized = normalizeWalletRows(rows);

  if (normalized.length === 0 && !options.reset) {
    return;
  }

  const grouped = groupByAccount(normalized);

  if (grouped.size === 0 && !options.reset) {
    return;
  }

  for (const [accountId, updates] of grouped) {
    const existed = Boolean(core.shell.getWallet(accountId));
    const wallet = ensureWallet(core, accountId);
    const reason = options.resolveReason({ existed });
    const diff = wallet.apply(updates, { reset: options.reset, reason });

    if (!diff) {
      continue;
    }

    recordMetrics(core, diff.next.updatedAt);
    logWalletUpdate({
      accountId,
      existed,
      action: options.action,
      reason,
      changed: diff.changed,
      updatedAt: diff.next.updatedAt,
    });
  }
}

function ensureWallet(core: BitMex, accountId: string): Wallet {
  const existing = core.shell.getWallet(accountId);
  if (existing) {
    return existing;
  }

  return core.shell.ensureWallet(accountId);
}

function normalizeWalletRows(rows: BitMexWallet[]): NormalizedWalletRow[] {
  const result: NormalizedWalletRow[] = [];

  for (const row of rows ?? []) {
    const normalized = normalizeWalletRow(row);
    if (normalized) {
      result.push(normalized);
    }
  }

  return result;
}

function normalizeWalletRow(row: BitMexWallet): NormalizedWalletRow | null {
  const accountId = normalizeAccountId(row.account);
  const currency = normalizeCurrency(row.currency);

  if (!accountId || !currency) {
    return null;
  }

  const update: WalletBalanceInput = {
    currency: currency.display,
  };

  assignNumberLike(update, 'amount', row.amount);
  assignNumberLike(update, 'pendingCredit', row.pendingCredit);
  assignNumberLike(update, 'pendingDebit', row.pendingDebit);
  assignNumberLike(update, 'confirmedDebit', row.confirmedDebit);
  assignNumberLike(update, 'transferIn', row.transferIn);
  assignNumberLike(update, 'transferOut', row.transferOut);
  assignNumberLike(update, 'deposited', row.deposited);
  assignNumberLike(update, 'withdrawn', row.withdrawn);

  const timestamp = normalizeWsTs(row.timestamp);
  const timestampMs = timestamp ? parseIsoTs(timestamp) : undefined;

  if (timestamp) {
    update.timestamp = timestamp;
  }

  return {
    accountId,
    currencyKey: currency.key,
    currencyDisplay: currency.display,
    update,
    timestampMs,
  };
}

function normalizeAccountId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  return undefined;
}

function normalizeCurrency(value: unknown): { key: string; display: string } | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return {
    key: trimmed.toLowerCase(),
    display: trimmed.toUpperCase(),
  };
}

function assignNumberLike(
  target: WalletBalanceInput,
  field: keyof WalletBalanceUpdate,
  value: unknown,
): void {
  if (value === null) {
    (target as Record<string, unknown>)[field] = null;
    return;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[field] = value;
  }
}

function groupByAccount(rows: NormalizedWalletRow[]): Map<string, WalletBalanceInput[]> {
  const grouped = new Map<string, Map<string, NormalizedWalletRow>>();

  for (const row of rows) {
    let byCurrency = grouped.get(row.accountId);
    if (!byCurrency) {
      byCurrency = new Map();
      grouped.set(row.accountId, byCurrency);
    }

    const existing = byCurrency.get(row.currencyKey);

    if (!existing) {
      byCurrency.set(row.currencyKey, row);
      continue;
    }

    if (row.timestampMs !== undefined && existing.timestampMs !== undefined) {
      if (row.timestampMs >= existing.timestampMs) {
        byCurrency.set(row.currencyKey, row);
      }
      continue;
    }

    if (row.timestampMs !== undefined && existing.timestampMs === undefined) {
      byCurrency.set(row.currencyKey, row);
      continue;
    }

    if (row.timestampMs === undefined && existing.timestampMs === undefined) {
      byCurrency.set(row.currencyKey, row);
    }
  }

  const result = new Map<string, WalletBalanceInput[]>();

  for (const [accountId, byCurrency] of grouped) {
    const updates = Array.from(byCurrency.values())
      .sort((a, b) => {
        if (a.timestampMs === undefined && b.timestampMs === undefined) {
          return 0;
        }
        if (a.timestampMs === undefined) {
          return -1;
        }
        if (b.timestampMs === undefined) {
          return 1;
        }
        return a.timestampMs - b.timestampMs;
      })
      .map((entry) => ({ ...entry.update }));

    result.set(accountId, updates);
  }

  return result;
}

function recordMetrics(core: BitMex, updatedAt?: string): void {
  const env: PrivateLabels['env'] = core.isTest ? 'testnet' : 'mainnet';
  const labels: PrivateLabels = { env, table: 'wallet' };

  incrementCounter(METRICS.walletUpdateCount, 1, labels);

  if (!updatedAt) {
    return;
  }

  const ageMs = Date.now() - parseIsoTs(updatedAt);
  if (!Number.isFinite(ageMs)) {
    return;
  }

  const ageSec = Math.max(0, ageMs / 1000);
  observeHistogram(METRICS.snapshotAgeSec, ageSec, labels);
  observeHistogram(METRICS.privateLatencyMs, Math.max(0, ageMs), labels);
}

type LogContext = {
  accountId: string;
  existed: boolean;
  action: 'partial' | 'insert' | 'update' | 'delete';
  reason: string;
  changed: readonly string[];
  updatedAt?: string;
};

function logWalletUpdate(context: LogContext): void {
  const { accountId, existed, action, reason, changed, updatedAt } = context;
  const tags = existed && action === 'partial' ? [...BASE_TAGS, LOG_TAGS.reconnect] : BASE_TAGS;

  if (action === 'partial') {
    const message = existed
      ? 'BitMEX wallet resync applied for account %s'
      : 'BitMEX wallet snapshot applied for account %s';

    log.debug(message, accountId, {
      tags,
      reason,
      changed,
      updatedAt: updatedAt ?? null,
    });
    return;
  }

  const messageMap: Record<Exclude<LogContext['action'], 'partial'>, string> = {
    insert: 'BitMEX wallet insert processed for account %s',
    update: 'BitMEX wallet update processed for account %s',
    delete: 'BitMEX wallet delete processed for account %s',
  };

  log.debug(messageMap[action], accountId, {
    tags,
    reason,
    changed,
    updatedAt: updatedAt ?? null,
  });
}
