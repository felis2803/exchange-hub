import { BaseCore } from '../BaseCore';

export class BinanceCore extends BaseCore {
    async connect(): Promise<void> {
        // Implement connection logic to Binance
        console.log('Connecting to Binance...');
    }

    async disconnect(): Promise<void> {
        // Implement disconnection logic from Binance
        console.log('Disconnecting from Binance...');
    }
}
