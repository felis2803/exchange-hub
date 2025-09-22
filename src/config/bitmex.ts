import { createLogger } from '../infra/logger.js';

/**
 * Default number of seconds added to the BitMEX auth `expires` timestamp.
 */
export const DEFAULT_AUTH_EXPIRES_SKEW_SEC = 60;

const MAX_AUTH_EXPIRES_SKEW_SEC = 300;

const log = createLogger('config:bitmex');

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

    if (parsed > MAX_AUTH_EXPIRES_SKEW_SEC) {
        log.warn('AUTH_EXPIRES_SKEW_SEC above safe maximum → clamping', {
            provided: parsed,
            max: MAX_AUTH_EXPIRES_SKEW_SEC,
        });

        return MAX_AUTH_EXPIRES_SKEW_SEC;
    }

    return parsed;
}
