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

### Errors

Библиотека использует унифицированную иерархию ошибок с кодами и сериализацией:

```ts
import { fromHttpResponse, NetworkError, RateLimitError, wrap } from 'exchange-hub';

async function fetchOrders() {
  try {
    // ... выполняем HTTP-запрос
  } catch (unknownError) {
    const err = wrap(unknownError, 'NETWORK_ERROR');
    if (err.isRetryable()) {
      // повторяем запрос
    }
    console.error(JSON.stringify(err.toJSON()));
    throw err;
  }
}

const error = fromHttpResponse({ status: 429, exchange: 'BitMEX' });
if (error instanceof RateLimitError && error.retryAfterMs) {
  console.log(`Подождите ${error.retryAfterMs} мс перед повтором`);
}

const networkIssue = new NetworkError('WebSocket disconnected', {
  exchange: 'Deribit',
  details: { reconnecting: true },
});
console.log(networkIssue.code); // "NETWORK_ERROR"
```

Коды ошибок: `NETWORK_ERROR`, `AUTH_ERROR`, `RATE_LIMIT`, `VALIDATION_ERROR`, `ORDER_REJECTED`, `EXCHANGE_DOWN`, `TIMEOUT`, `UNKNOWN_ERROR`.

## clOrdID и идемпотентность

BitMEX и большинство бирж требуют, чтобы `clOrdID` был уникальным в разумном
горизонте времени. Этот идентификатор используется для идемпотентности
постановки ордеров и для поиска заявок в журнале биржи. ExchangeHub предоставляет
утилиту `genClOrdID(seed?)`, генерирующую человекочитаемые идентификаторы вида
`prefix-timestamp-counter`. Чтобы минимизировать риск коллизий:

- задавайте уникальный префикс на инстанс или воркер (`EH-${podId}` или
  `deskA-worker3`); это упрощает трассировку запросов по логам и выделяет IDs
  разных процессов;
- храните соответствие `clOrdID → orderId` в своей персистентной модели, чтобы
  повторные попытки постановки могли переиспользовать одно и то же значение;
- пересоздавая процесс, передавайте тот же префикс и сбрасывайте счётчик только
  если уверены, что старые ордера уже обработаны биржей.

При необходимости вы можете полностью переопределить стратегию генерации, но
важно придерживаться договорённостей по префиксам, чтобы избежать конфликтов в
кластерной среде.

```ts
import { ExchangeHub, genClOrdID } from 'exchange-hub';

export const eh = new ExchangeHub('BitMex', {
  /*...*/
});
// Рекомендуется задавать уникальный префикс для clOrdID через переменную окружения:
// EH_PREFIX=my-desk-01
const clOrdID = genClOrdID(process.env.EH_PREFIX);
```

## BitMEX: timeInForce и postOnly

REST-обертка BitMEX в ExchangeHub принимает ограниченный набор значений `timeInForce`.
Алиасы нормализуются автоматически, остальные значения отклоняются с `ValidationError`.

| Алиас | Canonical           | Поведение                                                |
| ----- | ------------------- | -------------------------------------------------------- |
| `GTC` | `GoodTillCancel`    | ордер остаётся в книге до исполнения или отмены          |
| `IOC` | `ImmediateOrCancel` | немедленно исполняет доступный объем, остаток отменяется |
| `FOK` | `FillOrKill`        | либо исполняется целиком сразу, либо отменяется          |

Флаг `postOnly` применим только к лимитным ордерам. Попытка отправить `postOnly`
для `Market` будет отклонена маппером ещё до HTTP-запроса, что предотвращает
нежелательные рыночные агрессии.

## Торговля: buy/sell, postOnly, clOrdID

Торговый слой предоставляет симметричные методы `buy()` и `sell()` на `hub.Core`.
Они принимают нормализованный `PreparedPlaceInput` и возвращают объект `Order`,
который можно отслеживать через `getSnapshot()` или подписку `order.on('update', ...)`.

- Подготовьте payload через `Instrument.buy()/sell()` или утилиту `validatePlaceInput`;
  обязательно задайте `clOrdId`, чтобы повторные вызовы возвращали тот же ордер и
  оставались идемпотентными.
- `postOnly: true` автоматически превращается в `execInst=ParticipateDoNotInitiate`,
  а `reduceOnly` и `timeInForce` мапятся в соответствующие REST-поля.
- Все попытки постановки ордера логируются, а метрики `create_order_latency_ms`
  и `create_order_errors_total` помогают отслеживать успешные ответы и ошибки сети/биржи.

```ts
import { ExchangeHub, genClOrdID } from 'exchange-hub';
import { validatePlaceInput } from 'exchange-hub/validation';

const hub = new ExchangeHub('BitMex', { apiKey: '...', apiSec: '...' });

const normalized = validatePlaceInput({
  symbol: 'XBTUSD',
  side: 'buy',
  size: 10,
  type: 'Limit',
  price: 50_000,
  opts: { postOnly: true, timeInForce: 'GoodTillCancel', clOrdID: genClOrdID('desk-a') },
});

const order = await hub.Core.buy({
  ...normalized,
  options: { ...normalized.options, clOrdId: normalized.options.clOrdId ?? genClOrdID('desk-a') },
});

order.on('update', (snapshot) => {
  console.log('Order status', snapshot.status, 'leaves', snapshot.leavesQty);
});
```

Готовый пример «быстрого старта» расположен в `examples/place-order.ts`. Он
показывает, как собрать payload из переменных окружения и отправить лимитный или
рыночный ордер на Node.js 22.

## Domain events & types

ExchangeHub фиксирует единый контракт обновлений приватных доменных сущностей.

### BaseEntity

Каждая сущность (кошелек, позиции, ордера) реализует интерфейс `BaseEntity<TSnapshot>`.
Метод `getSnapshot()` возвращает актуальное представление в удобном формате, а события
`on('update', handler)` и `off('update', handler)` позволяют подписываться на изменения.
Обработчик всегда получает актуальный снимок и структуру `DomainUpdate<TSnapshot>` с diff,
а также опциональную строку `reason`, указывающую источник обновления (например, `"ws"`).

```ts
entity.on('update', (snapshot, { prev, next, changed }, reason) => {
  console.log('Wallet changed fields', changed, 'due to', reason);
});
```

### DomainUpdate<T>

`DomainUpdate<T>` содержит предыдущий снимок (`prev`), новый снимок (`next`) и список
измененных полей (`changed`). Это гарантированный контракт для всех приватных сущностей,
что позволяет переиспользовать обработчики обновлений без ветвления по типам.

### Правила эмита событий

- Все timestamps нормализуются в ISO (`TimestampISO`).
- Апдейты с устаревшими таймстампами игнорируются (используйте `isNewerByTimestamp`).
- Дубликаты устраняются через `dedupeByKey` для повторяющихся событий.
- События `update` эмитятся только если `changed.length > 0` (используйте `diffKeys`).
- При необходимости преобразовывайте сырой WS timestamp через `normalizeWsTs`.
