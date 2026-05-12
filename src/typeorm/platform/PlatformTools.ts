/* eslint-disable no-console */
import { appendFileSync, existsSync } from 'fs';
import { extname, normalize, resolve } from 'path';

import dotenv from 'dotenv';

import type { TDbConfig } from '../../types/config.types.js';

export { EventEmitter } from 'events';
export { ReadStream } from 'fs';
export { Readable, Writable } from 'stream';

const ANSI_RESET = '\u001B[0m';
const ANSI_GRAY = '\u001B[90m';
const ANSI_RED = '\u001B[31m';
const ANSI_YELLOW = '\u001B[33m';
const ANSI_UNDERLINE = '\u001B[4m';
const ANSI_BG_RED = '\u001B[41m';
const ANSI_BLACK = '\u001B[30m';

function colorize(value: unknown, ...codes: Array<string>): string {
  return `${codes.join('')}${String(value)}${ANSI_RESET}`;
}

/**
 * Platform-specific tools.
 */
export class PlatformTools {
  /**
   * Type of the currently running platform.
   */
  //TODO: In the future we need to add more types, at now we only support node
  public static type = 'node';

  /**
   * Gets global variable where global stuff can be stored.
   */
  public static getGlobalVariable(): unknown {
    return global;
  }

  public static async load(name: string): Promise<unknown> {
    try {
      switch (name) {
        /**
         * oracle
         */
        case 'oracledb':
          return import('oracledb');

        /**
         * postgres
         */
        case 'pg':
          return import('pg');
        case 'pg-native': {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require('pg-native');
        }
        case 'pg-query-stream': {
          const { default: QueryStream } = await import('pg-query-stream');
          return QueryStream;
        }
      }
    } catch {
      return import(resolve(process.cwd() + '/node_modules/' + name)).catch(
        () => {
          throw new TypeError(
            `Invalid Package for PlatformTools.load: ${name}`
          );
        }
      );
    }

    // If nothing above matched and we get here, the package was not listed within PlatformTools
    // and is an Invalid Package.  To make it explicit that this is NOT the intended use case for
    // PlatformTools.load - it's not just a way to replace `require` all willy-nilly - let's throw
    // an error.
    throw new TypeError(`Invalid Package for PlatformTools.load: ${name}`);
  }

  /**
   * Normalizes given path. Does "path.normalize" and replaces backslashes with forward slashes on Windows.
   */
  public static pathNormalize(pathStr: string): string {
    const normalizedPath = normalize(pathStr);
    return process.platform === 'win32'
      ? normalizedPath.replace(/\\/g, '/')
      : normalizedPath;
  }

  /**
   * Gets file extension. Does "path.extname".
   */
  public static pathExtname(pathStr: string): string {
    return extname(pathStr);
  }

  /**
   * Resolved given path. Does "path.resolve".
   */
  public static pathResolve(pathStr: string): string {
    return resolve(pathStr);
  }

  /**
   * Synchronously checks if file exist. Does "fs.existsSync".
   */
  public static fileExist(pathStr: string): boolean {
    return existsSync(pathStr);
  }

  //   public static appendFileSync(filename: string, data: any): void {
  //     appendFile(filename, data);
  //   }

  //   static async writeFile(path: string, data: any): Promise<void> {
  //     return fs.promises.writeFile(path, data);
  //   }

  /**
   * Loads a dotenv file into the environment variables.
   *
   * @param path The file to load as a dotenv configuration
   */
  public static dotenv(pathStr: string): void {
    dotenv.config({ path: pathStr });
  }

  /**
   * Gets environment variable.
   */
  public static getEnvVariable(name: string): string | undefined {
    return process.env[name];
  }

  /**
   * Hook for SQL highlighting. Kept as a no-op to avoid runtime formatter dependencies.
   */
  public static highlightSql(sql: string): string {
    return sql;
  }

  /**
   * Hook for SQL formatting. Kept as a no-op to avoid runtime formatter dependencies.
   */
  public static formatSql(
    sql: string,
    _dataSourceType?: TDbConfig['type']
  ): string {
    return sql;
  }

  /**
   * Logging functions needed by AdvancedConsoleLogger
   */
  public static logInfo(prefix: string, info: unknown): void {
    console.log(colorize(prefix, ANSI_GRAY, ANSI_UNDERLINE), info);
  }

  public static logError(prefix: string, error: unknown): void {
    console.log(colorize(prefix, ANSI_RED, ANSI_UNDERLINE), error);
  }

  public static logWarn(prefix: string, warning: unknown): void {
    console.log(colorize(prefix, ANSI_YELLOW, ANSI_UNDERLINE), warning);
  }

  public static log(message: string): void {
    console.log(colorize(message, ANSI_UNDERLINE));
  }

  public static info(info: unknown): string {
    return colorize(info, ANSI_GRAY);
  }

  public static error(error: unknown): string {
    return colorize(error, ANSI_RED);
  }

  public static warn(message: string): string {
    return colorize(message, ANSI_YELLOW);
  }

  public static logCmdErr(prefix: string, err?: unknown): void {
    console.log(colorize(prefix, ANSI_BLACK, ANSI_BG_RED));
    if (err) console.error(err);
  }

  public static appendFileSync(
    path: string,
    data: string | NodeJS.ArrayBufferView
  ): void {
    appendFileSync(path, data as string);
  }
}
