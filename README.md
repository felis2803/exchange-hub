# ExchangeHub

`ExchangeHub` is a TypeScript module that provides a unified API for accessing various cryptocurrency exchanges. It allows connecting to Binance, Bitmex, and other exchanges, abstracting the intricacies of their APIs.

## Installation

Install the module via npm:

```bash
npm install exchange-hub
```

## Quick Start

### Import and Create an Instance

```typescript
import { ExchangeHub } from 'exchange-hub';

// Connect to an exchange without keys (public APIs only)
const publicHub = new ExchangeHub('binance');

// Connect to an exchange with keys (authorized user actions available)
const privateHub = new ExchangeHub('bitmex', {
    apiKey: 'your_api_key',
    apiSecret: 'your_api_secret',
});
```

### Public API Usage

```typescript
// Fetch real-time trades
publicHub.getTrades('BTC/USD').then((trades) => {
    console.log(trades);
});

// Fetch order book
publicHub.getOrderBook('BTC/USD').then((orderBook) => {
    console.log(orderBook);
});

// Fetch instrument details
publicHub.getInstruments().then((instruments) => {
    console.log(instruments);
});
```

### Private API Usage

```typescript
// Fetch account balance
privateHub.getBalance().then((balance) => {
    console.log(balance);
});

// Place a new order
privateHub.placeOrder('BTC/USD', 'buy', 1, 50000).then((order) => {
    console.log(order);
});

// Cancel an order
privateHub.cancelOrder('order_id').then((response) => {
    console.log(response);
});
```

## API

### Constructor

```typescript
new ExchangeHub(exchange: string, credentials?: { apiKey: string; apiSecret: string });
```

-   `exchange`: The name of the exchange (e.g., 'binance', 'bitmex').
-   `credentials`: Optional. An object containing `apiKey` and `apiSecret`.

### Methods

#### Public Methods

-   `getTrades(pair: string): Promise<Trade[]>`
-   `getOrderBook(pair: string): Promise<OrderBook>`
-   `getInstruments(): Promise<Instrument[]>`

#### Private Methods

-   `getBalance(): Promise<Balance>`
-   `placeOrder(pair: string, side: 'buy' | 'sell', amount: number, price: number): Promise<Order>`
-   `cancelOrder(orderId: string): Promise<CancelResponse>`

## License

MIT License
