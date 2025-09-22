import { Instrument } from '../../../domain/instrument';
import type { InstrumentInit } from '../../../domain/instrument';
import { mapSymbolNativeToUni } from '../../../utils/symbolMapping';
import { TRADE_BUFFER_DEFAULT } from '../constants';
import type { BitMex } from '../index';
import type { BitMexChannelMessage, BitMexChannelMessageAction, BitMexInstrument } from '../types';

export function handleInstrumentMessage(
    core: BitMex,
    action: BitMexChannelMessageAction,
    data: BitMexInstrument[],
): void {
    switch (action) {
        case 'partial':
            handleInstrumentPartial(core, data);
            break;
        case 'insert':
            handleInstrumentInsert(core, data);
            break;
        case 'update':
            handleInstrumentUpdate(core, data);
            break;
        case 'delete':
            handleInstrumentDelete(core, data);
            break;
        default:
            break;
    }
}

export function handleInstrumentChannelMessage(core: BitMex, message: BitMexChannelMessage<'instrument'>): void {
    handleInstrumentMessage(core, message.action, message.data);
}

export function handleInstrumentPartial(core: BitMex, data: BitMexInstrument[]): void {
    core.resetInstrumentCache();

    for (const raw of data) {
        const instrument = createInstrument(core, raw);

        core.registerInstrument(instrument);
    }
}

export function handleInstrumentInsert(core: BitMex, data: BitMexInstrument[]): void {
    for (const raw of data) {
        const existing = core.getInstrumentByNative(raw.symbol);

        if (existing) {
            const changed = existing.applyUpdate(buildInstrumentUpdate(core, raw));

            if (changed) {
                core.refreshInstrumentKeys(existing);
            }

            continue;
        }

        const instrument = createInstrument(core, raw);

        core.registerInstrument(instrument);
    }
}

export function handleInstrumentUpdate(core: BitMex, data: BitMexInstrument[]): void {
    for (const raw of data) {
        const existing = core.getInstrumentByNative(raw.symbol);

        if (!existing) {
            const instrument = createInstrument(core, raw);

            core.registerInstrument(instrument);
            continue;
        }

        if (existing.status === 'delisted') {
            // Ignore updates for delisted instruments. They can be revived only via a new insert snapshot.
            continue;
        }

        const changed = existing.applyUpdate(buildInstrumentUpdate(core, raw));

        if (changed) {
            core.refreshInstrumentKeys(existing);
        }
    }
}

export function handleInstrumentDelete(core: BitMex, data: BitMexInstrument[]): void {
    for (const raw of data) {
        const existing = core.getInstrumentByNative(raw.symbol);

        if (!existing) {
            continue;
        }

        existing.applyUpdate({ status: 'delisted' });
    }
}

function createInstrument(core: BitMex, raw: BitMexInstrument): Instrument {
    const init = buildInstrumentUpdate(core, raw);

    return new Instrument(init, { tradeBufferSize: TRADE_BUFFER_DEFAULT });
}

function buildInstrumentUpdate(core: BitMex, raw: BitMexInstrument): InstrumentInit {
    const update: InstrumentInit = {
        symbolNative: raw.symbol,
        symbolUni: mapSymbolNativeToUni(raw.symbol, { enabled: core.symbolMappingEnabled }),
    };

    if (hasOwn(raw, 'state')) {
        update.status = normalizeStatus(raw.state);
    }

    if (hasOwn(raw, 'typ')) {
        update.type = raw.typ ?? null;
    }

    if (hasOwn(raw, 'underlying') || hasOwn(raw, 'rootSymbol')) {
        const base = hasOwn(raw, 'underlying') ? raw.underlying : raw.rootSymbol;

        update.baseCurrency = toLowerMaybe(base);
    }

    if (hasOwn(raw, 'quoteCurrency') || hasOwn(raw, 'settlCurrency')) {
        const quote = hasOwn(raw, 'quoteCurrency') ? raw.quoteCurrency : raw.settlCurrency;

        update.quoteCurrency = toLowerMaybe(quote);
    }

    if (hasOwn(raw, 'lotSize')) {
        update.lotSize = raw.lotSize ?? null;
    }

    if (hasOwn(raw, 'tickSize')) {
        update.tickSize = raw.tickSize ?? null;
    }

    if (hasOwn(raw, 'multiplier')) {
        update.multiplier = raw.multiplier ?? null;
    }

    if (hasOwn(raw, 'markPrice')) {
        update.markPrice = raw.markPrice ?? null;
    }

    if (hasOwn(raw, 'midPrice')) {
        update.indexPrice = raw.midPrice ?? null;
    }

    if (hasOwn(raw, 'lastPrice')) {
        update.lastPrice = raw.lastPrice ?? null;
    }

    if (hasOwn(raw, 'lastChangePcnt')) {
        update.lastChangePcnt = raw.lastChangePcnt ?? null;
    }

    if (hasOwn(raw, 'openInterest')) {
        update.openInterest = raw.openInterest ?? null;
    }

    if (hasOwn(raw, 'turnover24h')) {
        update.turnover24h = raw.turnover24h ?? null;
    }

    if (hasOwn(raw, 'volume24h')) {
        update.volume24h = raw.volume24h ?? null;
    }

    if (hasOwn(raw, 'fundingRate')) {
        update.fundingRate = raw.fundingRate ?? null;
    }

    if (hasOwn(raw, 'indicativeFundingRate')) {
        update.indicativeFundingRate = raw.indicativeFundingRate ?? null;
    }

    if (hasOwn(raw, 'fundingTimestamp')) {
        update.fundingTimestamp = raw.fundingTimestamp ?? null;
    }

    if (hasOwn(raw, 'fundingInterval')) {
        update.fundingInterval = raw.fundingInterval ?? null;
    }

    if (hasOwn(raw, 'expiry')) {
        update.expiry = raw.expiry ?? null;
    }

    if (hasOwn(raw, 'timestamp')) {
        update.timestamp = raw.timestamp ?? null;
    }

    const priceFilters = buildPriceFilters(raw);

    if (priceFilters) {
        update.priceFilters = priceFilters;
    }

    return update;
}

function buildPriceFilters(raw: BitMexInstrument): InstrumentInit['priceFilters'] | undefined {
    const filters: InstrumentInit['priceFilters'] = {};

    if (hasOwn(raw, 'limitDownPrice')) {
        filters.limitDownPrice = raw.limitDownPrice ?? null;
    }

    if (hasOwn(raw, 'limitUpPrice')) {
        filters.limitUpPrice = raw.limitUpPrice ?? null;
    }

    if (hasOwn(raw, 'maxPrice')) {
        filters.maxPrice = raw.maxPrice ?? null;
    }

    if (Object.keys(filters).length === 0) {
        return undefined;
    }

    return filters;
}

function hasOwn<T extends object, K extends keyof T>(obj: T, key: K): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function toLowerMaybe(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    return value.toLowerCase();
}

function normalizeStatus(state: string | null | undefined): string | null | undefined {
    if (state === undefined) {
        return undefined;
    }

    if (state === null) {
        return null;
    }

    return state.toLowerCase();
}
