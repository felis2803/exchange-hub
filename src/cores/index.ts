import { BitmexCore } from 'cores/bitmex';
import { BinanceCore } from './binance';
import { Settings } from './Settings';

export const coreClasses = {
    binance: BinanceCore,
    bitmex: BitmexCore,
} as const;

export type ExchangeNames = keyof typeof coreClasses;

export type CoreClass = (typeof coreClasses)[ExchangeNames];

export type Core = InstanceType<CoreClass>;

export async function initCore(
    exchangeName: ExchangeNames,
    settings?: Settings,
) {
    const CoreClass = coreClasses[exchangeName];

    if (!CoreClass) {
        throw new Error(`Exchange ${exchangeName} is not supported.`);
    }

    return new CoreClass(settings);
}
