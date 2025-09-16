import type { ExchangeName } from '../types';

declare module './BaseCore' {
    interface BaseCore<ExName extends ExchangeName> {
        readonly instruments: unknown;
    }
}
