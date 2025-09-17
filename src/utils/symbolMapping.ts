const PERP_SUFFIX = '.perp';

const BASE_NATIVE_TO_UNI: Record<string, string> = {
  XBT: 'btc',
};

const BASE_UNI_TO_NATIVE: Record<string, string> = Object.fromEntries(
  Object.entries(BASE_NATIVE_TO_UNI).map(([native, uni]) => [uni, native]),
);

const QUOTE_NATIVE_TO_UNI: Record<string, string> = {
  USD: 'usdt',
  USDT: 'usdt',
  USDC: 'usdc',
};

const QUOTE_UNI_TO_NATIVE: Record<string, string> = {
  usdt: 'USDT',
  usdc: 'USDC',
  usd: 'USD',
};

const QUOTE_SUFFIXES = Object.keys(QUOTE_UNI_TO_NATIVE);

export type SymbolMappingConfig = {
  enabled?: boolean;
};

function shouldMap(config?: SymbolMappingConfig): boolean {
  return config?.enabled ?? true;
}

function normalizeNative(symbol: string): string {
  return symbol.trim();
}

function normalizeUnified(symbol: string): string {
  return symbol.trim();
}

export function mapSymbolNativeToUni(symbol: string, config: SymbolMappingConfig = {}): string {
  const normalized = normalizeNative(symbol);

  if (!normalized || !shouldMap(config)) {
    return normalized;
  }

  const upper = normalized.toUpperCase();
  const match = upper.match(/^([A-Z0-9]+?)(USD|USDT|USDC)$/);

  if (!match) {
    return upper.toLowerCase();
  }

  const [, baseNative, quoteNative] = match;
  const baseUni = (BASE_NATIVE_TO_UNI[baseNative] ?? baseNative).toLowerCase();
  const quoteUni = QUOTE_NATIVE_TO_UNI[quoteNative] ?? quoteNative.toLowerCase();
  const isPerpetual = quoteNative === 'USD' || quoteNative === 'USDT';
  const suffix = isPerpetual ? PERP_SUFFIX : '';

  return `${baseUni}${quoteUni}${suffix}`;
}

export function mapSymbolUniToNative(symbol: string, config: SymbolMappingConfig = {}): string {
  const normalized = normalizeUnified(symbol);

  if (!normalized || !shouldMap(config)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  const hasPerpSuffix = lower.endsWith(PERP_SUFFIX);
  const withoutSuffix = hasPerpSuffix ? lower.slice(0, -PERP_SUFFIX.length) : lower;

  let detectedQuote: string | undefined;

  for (const candidate of QUOTE_SUFFIXES) {
    if (withoutSuffix.endsWith(candidate)) {
      detectedQuote = candidate;
      break;
    }
  }

  if (!detectedQuote) {
    return withoutSuffix.toUpperCase();
  }

  const basePart = withoutSuffix.slice(0, -detectedQuote.length);

  if (!basePart) {
    return withoutSuffix.toUpperCase();
  }

  const baseNative = BASE_UNI_TO_NATIVE[basePart] ?? basePart.toUpperCase();
  let quoteNative = QUOTE_UNI_TO_NATIVE[detectedQuote] ?? detectedQuote.toUpperCase();

  if (hasPerpSuffix || detectedQuote === 'usdt') {
    if (quoteNative === 'USDT') {
      quoteNative = 'USD';
    }
  }

  return `${baseNative}${quoteNative}`;
}

export function getUnifiedSymbolAliases(symbol: string): string[] {
  const normalized = normalizeUnified(symbol);

  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();

  const addVariant = (value: string) => {
    if (!value) {
      return;
    }

    variants.add(value);
    variants.add(value.toLowerCase());
    variants.add(value.toUpperCase());
  };

  addVariant(normalized);

  const lower = normalized.toLowerCase();

  if (lower.endsWith(PERP_SUFFIX)) {
    const withoutSuffix = normalized.slice(0, -PERP_SUFFIX.length);
    addVariant(withoutSuffix);
  }

  return Array.from(variants);
}
