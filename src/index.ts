import type { ExchangeName } from './types';

export { ExchangeHub } from './ExchangeHub';

console.log('ExchangeHub initialized');

declare module './cores/BaseCore' {
    interface BaseCore<ExName extends ExchangeName> {
        readonly instruments: unknown;
    }
}
