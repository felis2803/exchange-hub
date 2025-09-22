import { createHmac } from 'node:crypto';

/**
 * BitMEX signature helper.
 *
 * The payload format is `${verb}${pathWithQuery}${expires}${body}` where:
 * - `verb` must be upper-case HTTP method (GET/POST/...).
 * - `pathWithQuery` is the request path, including leading slash and query string.
 * - `expires` is the Unix timestamp in seconds used by BitMEX auth headers.
 * - `body` is the raw JSON string (empty string for requests without body).
 */
export function sign(verb: string, pathWithQuery: string, expires: number, body: string, apiSecret: string): string {
    const payload = `${verb.toUpperCase()}${pathWithQuery}${expires}${body}`;

    return createHmac('sha256', apiSecret).update(payload).digest('hex');
}
