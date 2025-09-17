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

export type BitMexSide = 'Buy' | 'Sell';

export type BitMexOrderType =
  | 'Market'
  | 'Limit'
  | 'Stop'
  | 'StopLimit'
  | 'MarketIfTouched'
  | 'LimitIfTouched'
  | 'MarketWithLeftoverAsLimit'
  | 'LimitWithLeftoverAsMarket'
  | 'StopMarket'
  | 'Pegged';

export type BitMexOrderStatus =
  | 'New'
  | 'PartiallyFilled'
  | 'Filled'
  | 'Canceled'
  | 'Rejected'
  | 'Triggered'
  | 'Expired';

export type BitMexTimeInForce =
  | 'Day'
  | 'GoodTillCancel'
  | 'ImmediateOrCancel'
  | 'FillOrKill'
  | 'GoodTillDate';

export type BitMexExecInst =
  | 'ParticipateDoNotInitiate'
  | 'AllOrNone'
  | 'MarkPrice'
  | 'LastPrice'
  | 'IndexPrice'
  | 'Close'
  | 'ReduceOnly'
  | 'Fixed'
  | 'Trail';

export type BitMexContingencyType =
  | 'OneCancelsTheOther'
  | 'OneTriggersTheOther'
  | 'OneUpdatesTheOtherAbsolute'
  | 'OneUpdatesTheOtherProportional';

export type BitMexPegPriceType =
  | 'LastPeg'
  | 'MidPricePeg'
  | 'MarketPeg'
  | 'PrimaryPeg'
  | 'TrailingStopPeg';

export type BitMexSettlementType = 'Settlement' | 'Delivery' | 'Termination' | 'Maturity';

export type BitMexTickDirection = 'PlusTick' | 'ZeroPlusTick' | 'MinusTick' | 'ZeroMinusTick';

export type BitMexTradeType = 'Regular' | 'BlockTrade';

export type BitMexInstrumentType =
  | 'FFWCSX'
  | 'FFCCSX'
  | 'FFICSX'
  | 'IFXXXP'
  | 'MRBXXX'
  | 'MRCXXX'
  | 'MRIXXX'
  | 'MRRXXX';

export type BitMexExecType =
  | 'New'
  | 'Trade'
  | 'Funding'
  | 'Settlement'
  | 'Canceled'
  | 'Calculated'
  | 'Expired'
  | 'Restated';

export type BitMexLastLiquidityInd =
  | 'AddedLiquidity'
  | 'RemovedLiquidity'
  | 'LiquidityIndeterminate';

export type BitMexTransactType =
  | 'Withdrawal'
  | 'Deposit'
  | 'Transfer'
  | 'Settlement'
  | 'Rebate'
  | 'Reward'
  | 'Fee';

export type BitMexTransactStatus = 'Pending' | 'Completed' | 'Canceled' | 'Rejected';

export type BitMexChannelMessageAction = 'partial' | 'insert' | 'update' | 'delete';

export type BitMexChannelMessage<Channel extends BitMexChannel> = {
  table: Channel;
  action: BitMexChannelMessageAction;
  data: BitMexChannelMessageMap[Channel][];
};

export type BitMexChannelMessageMap = {
  instrument: BitMexInstrument;
  trade: BitMexTrade;
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
  typ?: BitMexInstrumentType;
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
  lastTickDirection?: BitMexTickDirection;
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
  side: BitMexSide;
  size: number;
  price: number;
  tickDirection?: BitMexTickDirection;
  trdType?: BitMexTradeType;
  grossValue?: number;
  homeNotional?: number;
  foreignNotional?: number;
  timestamp: string;
};

export type BitMexLiquidation = {
  orderID: string;
  symbol: string;
  side: BitMexSide;
  price: number;
  leavesQty: number;
};

export type BitMexOrderBookL2 = {
  symbol: string;
  id: number;
  side: BitMexSide;
  size?: number;
  price?: number;
  timestamp?: string;
  transactTime?: string;
};

export type BitMexSettlement = {
  timestamp: string;
  symbol: string;
  settlementType: BitMexSettlementType;
  settledPrice?: number;
  optionStrikePrice?: number;
  optionUnderlyingPrice?: number;
  bankrupt?: number;
  taxBase?: number;
  taxRate?: number;
};

export type BitMexExecution = {
  execID: string;
  orderID: string;
  clOrdID?: string;
  clOrdLinkID?: string;
  account?: number;
  symbol: string;
  side?: BitMexSide;
  price?: number;
  orderQty?: number;
  displayQty?: number;
  stopPx?: number;
  pegOffsetValue?: number;
  pegPriceType?: BitMexPegPriceType;
  currency?: string;
  settlCurrency?: string;
  execType?: BitMexExecType;
  ordType?: BitMexOrderType;
  ordStatus?: BitMexOrderStatus;
  execInst?: BitMexExecInst;
  contingencyType?: BitMexContingencyType;
  timeInForce?: BitMexTimeInForce;
  leavesQty?: number;
  cumQty?: number;
  avgPx?: number;
  commission?: number;
  lastPx?: number;
  lastQty?: number;
  lastLiquidityInd?: BitMexLastLiquidityInd;
  text?: string;
  trdMatchID?: string;
  trdType?: BitMexTradeType;
  tradePublishIndicator?: string;
  transactTime?: string;
  timestamp?: string;
  grossValue?: number;
  homeNotional?: number;
  foreignNotional?: number;
  execCost?: number;
  execComm?: number;
  brokerCommission?: number;
  brokerExecComm?: number;
  feeType?: string;
  realisedPnl?: number;
  triggered?: string;
  ordRejReason?: string;
  workingIndicator?: boolean;
};

export type BitMexOrder = {
  orderID: string;
  clOrdID?: string;
  clOrdLinkID?: string;
  account?: number;
  symbol: string;
  side?: BitMexSide;
  simpleOrderQty?: number;
  orderQty?: number;
  price?: number;
  displayQty?: number;
  stopPx?: number;
  pegOffsetValue?: number;
  pegPriceType?: BitMexPegPriceType;
  currency?: string;
  settlCurrency?: string;
  ordType?: BitMexOrderType;
  timeInForce?: BitMexTimeInForce;
  execInst?: BitMexExecInst;
  contingencyType?: BitMexContingencyType;
  ordStatus?: BitMexOrderStatus;
  triggered?: string;
  workingIndicator?: boolean;
  ordRejReason?: string;
  leavesQty?: number;
  cumQty?: number;
  avgPx?: number;
  multiLegReportingType?: string;
  text?: string;
  transactTime?: string;
  timestamp?: string;
  simpleLeavesQty?: number;
  simpleCumQty?: number;
};

export type BitMexMargin = {
  account: number;
  currency: string;
  riskLimit: number;
  riskValue?: number;
  amount?: number;
  marginBalance: number;
  availableMargin: number;
  grossComm?: number;
  grossOpenCost?: number;
  grossOpenPremium?: number;
  grossExecCost?: number;
  grossMarkValue?: number;
  realisedPnl?: number;
  unrealisedPnl?: number;
  prevRealisedPnl?: number;
  initMargin?: number;
  maintMargin?: number;
  targetExcessMargin?: number;
  excessMargin?: number;
  makerFeeDiscount?: number;
  takerFeeDiscount?: number;
  marginLeverage?: number;
  marginUsedPcnt?: number;
  withdrawableMargin?: number;
  timestamp?: string;
  foreignMarginBalance?: number;
  foreignRequirement?: number;
  state?: string;
  walletBalance?: number;
};

export type BitMexPosition = {
  account: number;
  symbol: string;
  currency?: string;
  underlying?: string;
  quoteCurrency?: string;
  commission?: number;
  initMarginReq?: number;
  maintMarginReq?: number;
  riskLimit?: number;
  riskValue?: number;
  leverage?: number;
  crossMargin?: boolean;
  deleveragePercentile?: number;
  rebalancedPnl?: number;
  prevRealisedPnl?: number;
  prevUnrealisedPnl?: number;
  openingQty?: number;
  openOrderBuyQty?: number;
  openOrderBuyCost?: number;
  openOrderBuyPremium?: number;
  openOrderSellQty?: number;
  openOrderSellCost?: number;
  openOrderSellPremium?: number;
  currentQty?: number;
  currentCost?: number;
  currentComm?: number;
  realisedCost?: number;
  unrealisedCost?: number;
  grossOpenCost?: number;
  grossOpenPremium?: number;
  posCost?: number;
  posCost2?: number;
  posCross?: number;
  posLoss?: number;
  posMaint?: number;
  posMargin?: number;
  posComm?: number;
  posState?: string;
  homeNotional?: number;
  foreignNotional?: number;
  liquidationPrice?: number;
  bankruptPrice?: number;
  marginCallPrice?: number;
  avgEntryPrice?: number;
  avgCostPrice?: number;
  breakEvenPrice?: number;
  markPrice?: number;
  markValue?: number;
  timestamp?: string;
  realisedPnl?: number;
  unrealisedPnl?: number;
  unrealisedPnlPcnt?: number;
  unrealisedRoePcnt?: number;
  simpleQty?: number;
  simpleCost?: number;
  simpleValue?: number;
  simplePnl?: number;
  simplePnlPcnt?: number;
  isOpen?: boolean;
  maintMargin?: number;
  initMargin?: number;
};

export type BitMexTransact = {
  transactID: string;
  account: number;
  currency: string;
  transactType?: BitMexTransactType;
  amount: number;
  fee?: number;
  transactStatus?: BitMexTransactStatus;
  address?: string;
  tx?: string;
  orderID?: string;
  walletBalance?: number;
  timestamp?: string;
  transactTime?: string;
  text?: string;
  network?: string;
  memo?: string;
};

export type BitMexWallet = {
  account: number;
  currency: string;
  amount: number;
  pendingCredit?: number;
  pendingDebit?: number;
  confirmedDebit?: number;
  transferIn?: number;
  transferOut?: number;
  timestamp?: string;
  deposited?: number;
  withdrawn?: number;
};

export type BitMexPlaceOrderRequest = {
  symbol: string;
  side?: BitMexSide;
  simpleOrderQty?: number;
  orderQty?: number;
  price?: number;
  displayQty?: number;
  stopPx?: number;
  clOrdID?: string;
  clOrdLinkID?: string;
  pegOffsetValue?: number;
  pegPriceType?: BitMexPegPriceType;
  ordType?: BitMexOrderType;
  timeInForce?: BitMexTimeInForce;
  execInst?: BitMexExecInst;
  contingencyType?: BitMexContingencyType;
  text?: string;
};

export type BitMexChangeOrderRequest = {
  orderID?: string;
  origClOrdID?: string;
  clOrdID?: string;
  simpleOrderQty?: number;
  orderQty?: number;
  simpleLeavesQty?: number;
  leavesQty?: number;
  price?: number;
  stopPx?: number;
  pegOffsetValue?: number;
  pegPriceType?: BitMexPegPriceType;
  ordType?: BitMexOrderType;
  timeInForce?: BitMexTimeInForce;
  execInst?: BitMexExecInst;
  text?: string;
};

export type BitMexRequestVerb = 'GET' | 'POST' | 'PUT' | 'DELETE';
