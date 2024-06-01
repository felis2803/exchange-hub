# ExchangeHub

This project provides a unified interface for accessing various cryptocurrency exchanges. With this tool, you can connect to different exchanges (Bitmex, Bitfinex, Binance, etc.), retrieve information, and perform trades without delving into the details of each exchange's API.

## Features

-   Unified interface for multiple exchanges
-   Easy to use and integrate
-   Supports major exchanges like Bitmex, Bitfinex, Binance, and more

## Getting Started

1. Install the package:

```
npm install exchange-hub
```

2. Configure your exchange API keys.
3. Start using the unified interface to interact with the exchanges.

## Usage

Here's a basic example of how to use the package:

```javascript
const ExchangeHub = require('exchange-hub');

const config = {
    bitmex: {
        apiKey: 'your-bitmex-api-key',
        apiSecret: 'your-bitmex-api-secret',
    },
    binance: {
        apiKey: 'your-binance-api-key',
        apiSecret: 'your-binance-api-secret',
    },
    // Add configurations for other supported exchanges
};

const hub = new ExchangeHub(config);

// Example of retrieving account balance from Bitmex
hub.bitmex
    .getBalance()
    .then((balance) => {
        console.log('Bitmex Balance:', balance);
    })
    .catch((error) => {
        console.error('Error fetching Bitmex balance:', error);
    });

// Example of placing an order on Binance
hub.binance
    .placeOrder({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 1,
        price: 50000,
    })
    .then((order) => {
        console.log('Binance Order:', order);
    })
    .catch((error) => {
        console.error('Error placing Binance order:', error);
    });
```

## License

MIT
