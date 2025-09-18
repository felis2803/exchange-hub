import { format, inspect } from 'node:util';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const PLACEHOLDER_REGEX = /%[sdifjoOc]/g;

type LogContext = Record<string, unknown> & { tags?: readonly string[] };

function normalizeLevel(level?: string | LogLevel | null): LogLevel | undefined {
  if (!level) {
    return undefined;
  }
  const normalized = String(level).toLowerCase() as LogLevel;
  return LEVELS.includes(normalized) ? normalized : undefined;
}

let globalLevel: LogLevel = normalizeLevel(process.env.EXH_LOG_LEVEL) ?? 'info';

export function setLevel(level: LogLevel | string): void {
  const normalized = normalizeLevel(level);
  if (normalized) {
    globalLevel = normalized;
  }
}

export function getLevel(): LogLevel {
  return globalLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[globalLevel];
}

function isPlainObject(value: unknown): value is LogContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringifyContext(context: LogContext): string {
  try {
    return JSON.stringify(context);
  } catch {
    return inspect(context, { depth: null, compact: true, breakLength: Infinity });
  }
}

function mergeTags(
  base?: readonly unknown[],
  extra?: readonly unknown[],
): readonly string[] | undefined {
  const normalizedBase = base?.filter((value): value is string => typeof value === 'string') ?? [];
  const normalizedExtra =
    extra?.filter((value): value is string => typeof value === 'string') ?? [];

  if (normalizedBase.length === 0 && normalizedExtra.length === 0) {
    return undefined;
  }

  const merged = new Set<string>([...normalizedBase, ...normalizedExtra]);
  return Array.from(merged);
}

function mergeContext(base?: LogContext, extra?: LogContext): LogContext | undefined {
  if (!base) {
    return extra ? { ...extra } : undefined;
  }

  if (!extra) {
    return { ...base };
  }

  const { tags: baseTags, ...baseRest } = base;
  const { tags: extraTags, ...extraRest } = extra;

  const merged: LogContext = { ...baseRest, ...extraRest };
  const tags = mergeTags(baseTags, extraTags);
  if (tags && tags.length > 0) {
    merged.tags = tags;
  }

  return merged;
}

function appendContext(args: unknown[], baseContext?: LogContext): unknown[] {
  if (!baseContext) {
    return args;
  }

  if (args.length === 0) {
    return [{ ...baseContext }];
  }

  const candidate = args.at(-1);
  if (candidate && isPlainObject(candidate)) {
    const merged = mergeContext(baseContext, candidate as LogContext) ?? {};
    return [...args.slice(0, -1), merged];
  }

  return [...args, { ...baseContext }];
}

function formatMessage(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  let context: LogContext | undefined;
  let formatArgs = args;

  const candidate = args.at(-1);
  if (candidate && isPlainObject(candidate)) {
    const template = args[0];
    const placeholders = typeof template === 'string' ? countPlaceholders(template) : 0;
    const substitutionArgs = typeof template === 'string' ? args.length - 2 : 0;

    if (typeof template === 'string' && placeholders <= substitutionArgs) {
      context = candidate;
      formatArgs = args.slice(0, -1);
    }
  }

  const baseMessage =
    formatArgs.length > 0 ? format(...(formatArgs as [unknown, ...unknown[]])) : '';

  if (!context) {
    return baseMessage;
  }

  const messageWithContext = `${baseMessage}${baseMessage ? ' ' : ''}${stringifyContext(context)}`;
  return messageWithContext.trim();
}

function countPlaceholders(template: string): number {
  let count = 0;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while (PLACEHOLDER_REGEX.exec(template) !== null) {
    count += 1;
  }
  return count;
}

function formatLine(level: LogLevel, namespace: string | undefined, args: unknown[]): string {
  const message = formatMessage(args);
  const time = new Date().toISOString();
  const levelLabel = level.toUpperCase();
  const scope = namespace ? ` ${namespace}` : '';
  const separator = message ? ': ' : '';
  return `[${time}] ${levelLabel}${scope}${separator}${message}`;
}

function createWriter(level: LogLevel, namespace?: string, baseContext?: LogContext) {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  return (...args: unknown[]) => {
    if (!shouldLog(level)) {
      return;
    }
    const finalArgs = appendContext(args, baseContext);
    const line = formatLine(level, namespace, finalArgs);
    stream.write(`${line}\n`);
  };
}

export interface Logger {
  level(): LogLevel;
  setLevel(level: LogLevel | string): void;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  withContext(context: LogContext): Logger;
  withTags(tags: readonly string[]): Logger;
}

export function createLogger(namespace?: string, context?: LogContext): Logger {
  const baseContext = context ? { ...context } : undefined;

  const makeWriter = (level: LogLevel) => createWriter(level, namespace, baseContext);

  return {
    level: () => getLevel(),
    setLevel,
    trace: makeWriter('trace'),
    debug: makeWriter('debug'),
    info: makeWriter('info'),
    warn: makeWriter('warn'),
    error: makeWriter('error'),
    withContext(extra: LogContext): Logger {
      const nextContext = mergeContext(baseContext, extra);
      return createLogger(namespace, nextContext);
    },
    withTags(tags: readonly string[]): Logger {
      const nextContext = mergeContext(baseContext, { tags });
      return createLogger(namespace, nextContext);
    },
  };
}
