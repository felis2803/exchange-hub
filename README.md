# ExchangeHub

## Logging

ExchangeHub ships with a lightweight logger that works out-of-the-box in Node.js 22.
It exposes the usual console-like API while adding log levels and structured context.
The logger writes formatted messages to stdout/stderr using ISO timestamps, for example:

```
[2024-05-05T08:00:00.000Z] INFO exchange-hub: ExchangeHub initialized
```

### Configure the level

The log level can be configured globally. By default it is set to `info`.

- Environment variable (takes effect on startup):
  ```bash
  EXH_LOG_LEVEL=debug node app.js
  ```
- Programmatically at runtime:

  ```ts
  import { createLogger } from 'exchange-hub';

  const log = createLogger('my-bot');
  log.setLevel('trace');
  ```

Supported levels in ascending order are `trace`, `debug`, `info`, `warn`, and `error`.
Calls below the active level are no-ops and do not perform formatting work.

### Usage examples

```ts
import { createLogger } from 'exchange-hub';

const log = createLogger('orders');
const orderId = '123';

log.info('Placed order %s', orderId, { symbol: 'btcusdt' });
log.warn('Retrying request %d/3', 2);
log.error('Request failed', new Error('timeout'));
```

Passing a trailing object attaches context to the message. It will be stringified lazily
only when the log level allows the message to be emitted.
