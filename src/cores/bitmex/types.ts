import type { BITMEX_PRIVATE_CHANNELS, BITMEX_PUBLIC_CHANNELS, BITMEX_CHANNELS } from './constants';

export type BitMexWelcomeMessage = {
    info: string;
    version: string | number;
    timestamp?: string;
    docs?: string;
};

export type BitMexSubscribeMessage = {
    success: boolean;
    subscribe: BitMexChannel;
    request: {
        op: string;
        args: BitMexChannel[];
    };
};

export type BitMexPublicChannel = (typeof BITMEX_PUBLIC_CHANNELS)[number];
export type BitMexPrivateChannel = (typeof BITMEX_PRIVATE_CHANNELS)[number];
export type BitMexChannel = (typeof BITMEX_CHANNELS)[number];

export type BitMexChannelMessageAction = 'partial' | 'insert' | 'update' | 'delete';

export type BitMexChannelMessage<Channel extends BitMexChannel> = {
    table: Channel;
    action: BitMexChannelMessageAction;
    data: BitMexChannelMessageMap[Channel][];
};

export type BitMexChannelMessageMap = {
    instrument: BitMexInstrument;
    trade: BitMexTrade;
    funding: BitMexFunding;
    liquidation: BitMexLiquidation;
    orderBookL2: BitMexOrderBookL2;
    settlement: BitMexSettlement;
    execution: BitMexExecution;
    order: BitMexOrder;
    margin: BitMexMargin;
    position: BitMexPosition;
    transact: BitMexTransact;
    wallet: BitMexWallet;
};

export type BitMexInstrument = {
    symbol: string;
    rootSymbol?: string;
    state?: string;
    typ?: string;
    listing?: string;
    front?: string;
    expiry?: string;
    settle?: string;
    listedSettle?: string;
    positionCurrency?: string;
    underlying?: string;
    quoteCurrency?: string;
    underlyingSymbol?: string;
    reference?: string;
    referenceSymbol?: string;
    calcInterval?: string;
    publishInterval?: string;
    publishTime?: string;
    maxOrderQty?: number;
    maxPrice?: number;
    lotSize?: number;
    tickSize?: number;
    multiplier?: number;
    settlCurrency?: string;
    underlyingToPositionMultiplier?: number;
    underlyingToSettleMultiplier?: number;
    quoteToSettleMultiplier?: number;
    isQuanto?: boolean;
    isInverse?: boolean;
    initMargin?: number;
    maintMargin?: number;
    riskLimit?: number;
    riskStep?: number;
    limit?: number;
    capped?: boolean;
    taxed?: boolean;
    deleverage?: boolean;
    makerFee?: number;
    takerFee?: number;
    settlementFee?: number;
    fundingBaseRate?: number;
    fundingQuoteRate?: number;
    fundingBaseSymbol?: string;
    fundingQuoteSymbol?: string;
    fundingPremiumSymbol?: string;
    fundingTimestamp?: string;
    fundingInterval?: string;
    fundingRate?: number;
    indicativeFundingRate?: number;
    rebalanceTimestamp?: string;
    rebalanceInterval?: string;
    openingTimestamp?: string;
    closingTimestamp?: string;
    sessionInterval?: string;
    prevClosePrice?: number;
    limitDownPrice?: number;
    limitUpPrice?: number;
    bankruptLimitDownPrice?: number;
    bankruptLimitUpPrice?: number;
    prevTotalVolume?: number;
    totalVolume?: number;
    volume?: number;
    volume24h?: number;
    prevTotalTurnover?: number;
    totalTurnover?: number;
    turnover?: number;
    turnover24h?: number;
    homeNotional24h?: number;
    foreignNotional24h?: number;
    prevPrice24h?: number;
    vwap?: number;
    highPrice?: number;
    lowPrice?: number;
    lastPrice?: number;
    lastPriceProtected?: number;
    lastTickDirection?: string;
    lastChangePcnt?: number;
    bidPrice?: number;
    midPrice?: number;
    askPrice?: number;
    impactBidPrice?: number;
    impactMidPrice?: number;
    impactAskPrice?: number;
    hasLiquidity?: boolean;
    openInterest?: number;
    openValue?: number;
    fairMethod?: string;
    fairBasisRate?: number;
    fairBasis?: number;
    fairPrice?: number;
    markMethod?: string;
    markPrice?: number;
    indicativeTaxRate?: number;
    indicativeSettlePrice?: number;
    optionUnderlyingPrice?: number;
    settledPrice?: number;
    settledPriceAdjustmentRate?: number;
    instantPnl?: number;
    minTick?: number;
    timestamp?: string;
};

export type BitMexTrade = {
    trdMatchID: string;
    symbol: string;
    side: 'Buy' | 'Sell';
    size: number;
    price: number;
    timestamp: string;
};

export type BitMexFunding = {
    timestamp: string;
    symbol: string;
    fundingRate: number;
    fundingRateDaily: number;
};

export type BitMexLiquidation = {
    orderID: string;
    symbol: string;
    side: 'Buy' | 'Sell';
    price: number;
    leavesQty: number;
};

export type BitMexOrderBookL2 = {
    symbol: string;
    id: number;
    side: 'Buy' | 'Sell';
    size?: number;
    price?: number;
};

export type BitMexSettlement = {
    timestamp: string;
    symbol: string;
    settlementType: string;
    settlePrice?: number;
};

export type BitMexExecution = {
    execID: string;
    orderID: string;
    clOrdID?: string;
    symbol: string;
    side?: 'Buy' | 'Sell';
    price?: number;
    size?: number;
};

export type BitMexOrder = {
    orderID: string;
    clOrdID?: string;
    symbol: string;
    side?: 'Buy' | 'Sell';
    price?: number;
    orderQty?: number;
    ordStatus?: string;
};

export type BitMexMargin = {
    account: number;
    currency: string;
    riskLimit: number;
    marginBalance: number;
    availableMargin: number;
};

export type BitMexPosition = {
    account: number;
    symbol: string;
    currentQty?: number;
    avgEntryPrice?: number;
    liquidationPrice?: number;
};

export type BitMexTransact = {
    transactID: string;
    account: number;
    currency: string;
    transactType?: string;
    amount: number;
    fee?: number;
    transactStatus?: string;
    address?: string;
    timestamp?: string;
};

export type BitMexWallet = {
    account: number;
    currency: string;
    balance: number;
    availableMargin?: number;
    walletBalance?: number;
};
