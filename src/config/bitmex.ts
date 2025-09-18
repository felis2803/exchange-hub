const DEFAULT_AUTH_EXPIRES_SKEW_SEC = 60;

export interface BitmexCredentials {
  apiKey: string;
  apiSecret: string;
}

export function getBitmexCredentials(): BitmexCredentials | null {
  const apiKey = process.env.BITMEX_API_KEY?.trim();
  const apiSecret = process.env.BITMEX_API_SECRET?.trim();

  if (!apiKey || !apiSecret) {
    return null;
  }

  return { apiKey, apiSecret };
}

export function getAuthExpiresSkewSec(): number {
  const raw = process.env.AUTH_EXPIRES_SKEW_SEC?.trim();

  if (!raw) {
    return DEFAULT_AUTH_EXPIRES_SKEW_SEC;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AUTH_EXPIRES_SKEW_SEC;
  }

  return parsed;
}

export { DEFAULT_AUTH_EXPIRES_SKEW_SEC };
