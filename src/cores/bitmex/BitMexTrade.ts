export class BitMexTrade {
    trdMatchID!: string;
    symbol!: string;
    side!: 'Buy' | 'Sell';
    size!: number;
    price!: number;
    timestamp!: string;

    constructor(data: Partial<BitMexTrade>) {
        Object.assign(this, data);
    }
}
