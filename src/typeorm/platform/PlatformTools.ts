import { appendFileSync, existsSync } from 'fs';
import { extname, normalize, resolve } from 'path';

import { format as sqlFormat } from '@sqltools/formatter';
import type { Config as SqlFormatterConfig } from '@sqltools/formatter/lib/core/types.js';
import ansi from 'ansis';
import dotenv from 'dotenv';
import { highlight } from 'sql-highlight';

import type { TDbConfig } from '../../types/config.types.js';

export { EventEmitter } from 'events';
export { ReadStream } from 'fs';
export { Readable, Writable } from 'stream';

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

  public static load(name: string): Promise<unknown> {
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
        case 'pg-native':
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return Promise.resolve(require('pg-native') as unknown);
        case 'pg-query-stream':
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return Promise.resolve(require('pg-query-stream') as unknown);
      }
    } catch {
      // If package is not found in switch, try to dynamically import it
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
   * Highlights sql string to be printed in the console.
   */
  public static highlightSql(sql: string): string {
    return highlight(sql, {
      colors: {
        keyword: ansi.blueBright.open,
        function: ansi.magentaBright.open,
        number: ansi.green.open,
        string: ansi.white.open,
        identifier: ansi.white.open,
        special: ansi.white.open,
        bracket: ansi.white.open,
        comment: ansi.gray.open,
        clear: ansi.reset.open,
      },
    });
  }

  /**
   * Pretty-print sql string to be print in the console.
   */
  public static formatSql(
    sql: string,
    dataSourceType?: TDbConfig['type']
  ): string {
    const databaseLanguageMap: Record<string, SqlFormatterConfig['language']> =
      {
        oracle: 'pl/sql',
      };

    const databaseLanguage = dataSourceType
      ? (databaseLanguageMap[dataSourceType] ?? 'sql')
      : 'sql';

    return sqlFormat(sql, {
      language: databaseLanguage,
      indent: '    ',
    });
  }

  /**
   * Logging functions needed by AdvancedConsoleLogger
   */
  public static logInfo(prefix: string, info: unknown): void {
    console.log(ansi.gray.underline(prefix), info);
  }

  public static logError(prefix: string, error: unknown): void {
    console.log(ansi.underline.red(prefix), error);
  }

  public static logWarn(prefix: string, warning: unknown): void {
    console.log(ansi.underline.yellow(prefix), warning);
  }

  public static log(message: string): void {
    console.log(ansi.underline(message));
  }

  public static info(info: unknown): string {
    return ansi.gray(info);
  }

  public static error(error: unknown): string {
    return ansi.red(error);
  }

  public static warn(message: string): string {
    return ansi.yellow(message);
  }

  public static logCmdErr(prefix: string, err?: unknown): void {
    console.log(ansi.black.bgRed(prefix));
    if (err) console.error(err);
  }

  public static appendFileSync(
    path: string,
    data: string | NodeJS.ArrayBufferView
  ): void {
    appendFileSync(path, data as string);
  }
}
