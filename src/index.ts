import { createLogger } from './infra/logger.js';

const log = createLogger('exchange-hub');
log.info('ExchangeHub initialized');

export { createLogger, getLevel, setLevel } from './infra/logger.js';
export type { LogLevel, Logger } from './infra/logger.js';
