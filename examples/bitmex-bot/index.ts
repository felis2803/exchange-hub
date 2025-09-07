import { ExchangeHub } from '../../src/ExchangeHub';

async function main() {
    const eh = new ExchangeHub('BitMex', { isTest: true });

    await eh.connect();

    console.log(eh.instruments);
}

main();
