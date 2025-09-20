/* eslint-disable no-console */

import { ExchangeHub } from '../src/ExchangeHub.js';
import { genClOrdID } from '../src/infra/ids.js';
import { validatePlaceInput, type PreparedPlaceInput } from '../src/infra/validation.js';

function parsePositiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }

  return parsed;
}

async function main() {
  const useTestnet = process.env.BITMEX_IS_TEST === 'true';
  const hub = new ExchangeHub('BitMex', {
    isTest: useTestnet,
    apiKey: process.env.BITMEX_API_KEY,
    apiSec: process.env.BITMEX_API_SECRET,
  });

  const symbol = (process.env.BITMEX_SYMBOL ?? 'XBTUSD').trim() || 'XBTUSD';
  const size = parsePositiveNumber(process.env.BITMEX_ORDER_SIZE, 1, 'BITMEX_ORDER_SIZE');
  const rawPrice = process.env.BITMEX_LIMIT_PRICE?.trim();
  const priceValue = rawPrice && rawPrice.length > 0 ? Number(rawPrice) : undefined;

  if (priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue <= 0)) {
    throw new Error('BITMEX_LIMIT_PRICE must be a positive number');
  }

  const sideEnv = (process.env.BITMEX_SIDE ?? 'buy').toLowerCase();
  const side = sideEnv === 'sell' ? 'sell' : 'buy';
  const type: PreparedPlaceInput['type'] = priceValue === undefined ? 'Market' : 'Limit';

  const postOnly = type === 'Limit' && process.env.BITMEX_POST_ONLY === 'true';
  const reduceOnly = process.env.BITMEX_REDUCE_ONLY === 'true';
  const rawTif = process.env.BITMEX_TIME_IN_FORCE?.trim();
  const timeInForce =
    type === 'Limit' ? (rawTif && rawTif.length > 0 ? rawTif : 'GoodTillCancel') : undefined;

  const clOrdId = process.env.BITMEX_CL_ORD_ID ?? genClOrdID(process.env.EH_PREFIX);

  const normalized = validatePlaceInput({
    symbol,
    side,
    size,
    price: priceValue,
    type,
    opts: {
      postOnly,
      reduceOnly,
      timeInForce,
      clOrdID: clOrdId,
    },
  });

  const prepared: PreparedPlaceInput = {
    ...normalized,
    options: { ...normalized.options, clOrdId },
  };

  try {
    await hub.connect();

    const place =
      side === 'sell' ? hub.Core.sell.bind(hub.Core) : hub.Core.buy.bind(hub.Core);

    console.log(
      'Submitting %s %s order on %s (size=%d, price=%s, clOrdId=%s)',
      type.toLowerCase(),
      side.toUpperCase(),
      symbol,
      size,
      type === 'Limit' ? normalized.price : 'MARKET',
      clOrdId,
    );

    const order = await place(prepared);
    const snapshot = order.getSnapshot();

    console.log('Exchange accepted order %s with status %s', snapshot.orderId, snapshot.status);
    console.log(
      'execInst=%s leavesQty=%s avgFillPrice=%s',
      snapshot.execInst,
      snapshot.leavesQty,
      snapshot.avgFillPrice,
    );
  } catch (error) {
    console.error('Order placement failed', error);
    process.exitCode = 1;
  } finally {
    await hub.disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('Unexpected error in place-order example', error);
  process.exitCode = 1;
});
