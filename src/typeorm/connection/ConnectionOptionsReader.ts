import { createRequire } from 'module';
import path from 'path';

import appRootPath from 'app-root-path';

import type { DataSourceOptions } from '../data-source/DataSourceOptions.js';
import { TypeORMError } from '../error/TypeORMError.js';
import { PlatformTools } from '../platform/PlatformTools.js';
import { importOrRequireFile } from '../util/ImportUtils.js';
import { isAbsolute } from '../util/PathUtils.js';

import { ConnectionOptionsEnvReader } from './options-reader/ConnectionOptionsEnvReader.js';

/**
 * Reads connection options from the ormconfig.
 */
export class ConnectionOptionsReader {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    protected options?: {
      /**
       * Directory where ormconfig should be read from.
       * By default its your application root (where your app package.json is located).
       */
      root?: string;

      /**
       * Filename of the ormconfig configuration. By default its equal to "ormconfig".
       */
      configName?: string;
    }
  ) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Returns all connection options read from the ormconfig.
   */
  public async all(): Promise<Array<DataSourceOptions>> {
    const options = await this.load();
    if (!options)
      throw new TypeORMError(
        `No connection options were found in any orm configuration files.`
      );

    return options;
  }

  /**
   * Gets a connection with a given name read from ormconfig.
   * If connection with such name would not be found then it throw error.
   */
  public async get(name: string): Promise<DataSourceOptions> {
    const allOptions = await this.all();
    const targetOptions = allOptions.find(
      (options) =>
        options.name === name || (name === 'default' && !options.name)
    );
    if (!targetOptions)
      throw new TypeORMError(
        `Cannot find connection ${name} because its not defined in any orm configuration files.`
      );

    return targetOptions;
  }

  /**
   * Checks if there is a TypeORM configuration file.
   */
  public async has(name: string): Promise<boolean> {
    const allOptions = await this.load();
    if (!allOptions) return false;

    const targetOptions = allOptions.find(
      (options) =>
        options.name === name || (name === 'default' && !options.name)
    );
    return !!targetOptions;
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Loads all connection options from a configuration file.
   *
   * todo: get in count NODE_ENV somehow
   */
  protected async load(): Promise<Array<DataSourceOptions> | undefined> {
    let connectionOptions:
      | DataSourceOptions
      | Array<DataSourceOptions>
      | undefined = undefined;

    const fileFormats = ['env', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json'];

    // Detect if baseFilePath contains file extension
    const possibleExtension = this.baseFilePath.substr(
      this.baseFilePath.lastIndexOf('.')
    );
    const fileExtension = fileFormats.find(
      (extension) => `.${extension}` === possibleExtension
    );

    // try to find any of following configuration formats
    const foundFileFormat =
      fileExtension ||
      fileFormats.find((format) => {
        return PlatformTools.fileExist(this.baseFilePath + '.' + format);
      });

    // Determine config file name
    const configFile = fileExtension
      ? this.baseFilePath
      : this.baseFilePath + '.' + foundFileFormat;

    // if .env file found then load all its variables into process.env using dotenv package
    if (foundFileFormat === 'env') {
      PlatformTools.dotenv(configFile);
    } else if (PlatformTools.fileExist(this.baseDirectory + '/.env')) {
      PlatformTools.dotenv(this.baseDirectory + '/.env');
    }

    // try to find connection options from any of available sources of configuration
    if (
      PlatformTools.getEnvVariable('TYPEORM_CONNECTION') ||
      PlatformTools.getEnvVariable('TYPEORM_URL')
    ) {
      connectionOptions = new ConnectionOptionsEnvReader().read();
    } else if (
      foundFileFormat === 'js' ||
      foundFileFormat === 'mjs' ||
      foundFileFormat === 'cjs' ||
      foundFileFormat === 'ts' ||
      foundFileFormat === 'mts' ||
      foundFileFormat === 'cts'
    ) {
      const [importOrRequireResult, moduleSystem] =
        await importOrRequireFile(configFile);
      const configModule = await importOrRequireResult;

      if (
        moduleSystem === 'esm' ||
        (configModule &&
          typeof configModule === 'object' &&
          '__esModule' in configModule &&
          'default' in configModule)
      ) {
        connectionOptions = (configModule as Record<string, unknown>)
          .default as DataSourceOptions | Array<DataSourceOptions>;
      } else {
        connectionOptions = configModule as
          | DataSourceOptions
          | Array<DataSourceOptions>;
      }
    } else if (foundFileFormat === 'json') {
      const require = createRequire(import.meta.url);
      connectionOptions = require(configFile) as
        | DataSourceOptions
        | Array<DataSourceOptions>
        | undefined;
    }

    // normalize and return connection options
    if (connectionOptions) {
      return this.normalizeConnectionOptions(connectionOptions);
    }

    return undefined;
  }

  /**
   * Normalize connection options.
   */
  protected normalizeConnectionOptions(
    connectionOptions: DataSourceOptions | Array<DataSourceOptions>
  ): Array<DataSourceOptions> {
    if (!Array.isArray(connectionOptions))
      connectionOptions = [connectionOptions];

    connectionOptions.forEach((options) => {
      options.baseDirectory = this.baseDirectory;
      if (options.entities) {
        const entities = (options.entities as Array<unknown>).map((entity) => {
          if (typeof entity === 'string' && entity.substr(0, 1) !== '/')
            return this.baseDirectory + '/' + entity;

          return entity;
        });
        Object.assign(connectionOptions, { entities: entities });
      }
      if (options.subscribers) {
        const subscribers = (options.subscribers as Array<unknown>).map(
          (subscriber) => {
            if (
              typeof subscriber === 'string' &&
              subscriber.substr(0, 1) !== '/'
            )
              return this.baseDirectory + '/' + subscriber;

            return subscriber;
          }
        );
        Object.assign(connectionOptions, { subscribers: subscribers });
      }
      if (options.migrations) {
        const migrations = (options.migrations as Array<unknown>).map(
          (migration) => {
            if (typeof migration === 'string' && migration.substr(0, 1) !== '/')
              return this.baseDirectory + '/' + migration;

            return migration;
          }
        );
        Object.assign(connectionOptions, { migrations: migrations });
      }

      // make database path file in sqlite relative to package.json
      if (
        options.type === ('sqlite' as string) ||
        options.type === ('better-sqlite3' as string)
      ) {
        const db = (options as DataSourceOptions & { database?: string })
          .database;
        if (
          typeof db === 'string' &&
          !isAbsolute(db) &&
          db.substr(0, 1) !== '/' && // unix absolute
          db.substr(1, 2) !== ':\\' && // windows absolute
          db !== ':memory:'
        ) {
          Object.assign(options as DataSourceOptions & { database: string }, {
            database: this.baseDirectory + '/' + db,
          });
        }
      }
    });

    return connectionOptions;
  }

  /**
   * Gets directory where configuration file should be located and configuration file name.
   */
  protected get baseFilePath(): string {
    return path.resolve(this.baseDirectory, this.baseConfigName);
  }

  /**
   * Gets directory where configuration file should be located.
   */
  protected get baseDirectory(): string {
    return this.options?.root ?? appRootPath.path;
  }

  /**
   * Gets configuration file name.
   */
  protected get baseConfigName(): string {
    return this.options?.configName ?? 'ormconfig';
  }
}
