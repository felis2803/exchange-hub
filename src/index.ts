import { createLogger } from './infra/logger';

const log = createLogger('exchange-hub');
log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel } from './infra/logger';
export type { LogLevel, Logger } from './infra/logger';
