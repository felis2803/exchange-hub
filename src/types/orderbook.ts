export type L2Row = {
  id: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
};

export type L2Best = {
  price: number;
  size: number;
};

export type L2BatchDelta = {
  changed: {
    bids: number;
    asks: number;
  };
  bestBid?: L2Best | null;
  bestAsk?: L2Best | null;
};
