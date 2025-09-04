import type { BitMexInstrument } from './BitMexInstrument';
import type { BitMexTrade } from './BitMexTrade';

export type InstrumentPartialMessage = {
    table: 'instrument';
    action: 'partial';
    data: BitMexInstrument[];
    keys: string[];
    types: Record<string, string>;
    foreignKeys: Record<string, string>;
    attributes: Record<string, string>;
};

export type InstrumentInsertMessage = {
    table: 'instrument';
    action: 'insert';
    data: BitMexInstrument[];
};

export type InstrumentUpdateMessage = {
    table: 'instrument';
    action: 'update';
    data: BitMexInstrument[];
};

export type InstrumentDeleteMessage = {
    table: 'instrument';
    action: 'delete';
    data: BitMexInstrument[];
};

export type InstrumentMessage =
    | InstrumentPartialMessage
    | InstrumentInsertMessage
    | InstrumentUpdateMessage
    | InstrumentDeleteMessage;

export type TradeMessage = {
    table: 'trade';
    action: 'partial' | 'insert';
    data: BitMexTrade[];
};
