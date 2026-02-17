import { LogLevel } from './Logger';

/**
 * Logging options.
 */
export type LoggerOptions = boolean | 'all' | Array<LogLevel>;

/**
 * File logging option.
 */
export interface FileLoggerOptions {
  /**
   * Specify custom path for log file, relative to application root
   */
  logPath: string;
}
