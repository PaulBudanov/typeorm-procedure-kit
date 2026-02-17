import { ObjectUtils } from '../util/ObjectUtils.js';

import { AdvancedConsoleLogger } from './AdvancedConsoleLogger.js';
import { DebugLogger } from './DebugLogger.js';
import { FileLogger } from './FileLogger.js';
import { FormattedConsoleLogger } from './FormattedConsoleLogger.js';
import type { Logger } from './Logger.js';
import type { LoggerOptions } from './LoggerOptions.js';
import { SimpleConsoleLogger } from './SimpleConsoleLogger.js';

/**
 * Helps to create logger instances.
 */
export class LoggerFactory {
  /**
   * Creates a new logger depend on a given connection's driver.
   */
  public create(
    logger?:
      | 'advanced-console'
      | 'simple-console'
      | 'formatted-console'
      | 'file'
      | 'debug'
      | Logger,
    options?: LoggerOptions
  ): Logger {
    if (ObjectUtils.isObject(logger)) return logger as Logger;

    if (logger) {
      switch (logger) {
        case 'simple-console':
          return new SimpleConsoleLogger(options);

        case 'file':
          return new FileLogger(options);

        case 'advanced-console':
          return new AdvancedConsoleLogger(options);

        case 'formatted-console':
          return new FormattedConsoleLogger(options);

        case 'debug':
          return new DebugLogger();
      }
    }

    return new AdvancedConsoleLogger(options);
  }
}
