import { ExchangeHub } from '../../src/ExchangeHub';

async function main() {
    const eh = new ExchangeHub('BitMex', { isTest: true });

    await eh.connect();

    const symbols = eh.instruments.map(instrument => instrument.symbol);
    const ordersMap = eh.instruments.map(instrument => ({ symbol: instrument.symbol, orders: instrument.orders }));

    console.log({ symbols, ordersMap });
}

main();
