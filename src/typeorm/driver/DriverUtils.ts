import { ServerError } from '../../utils/server-error.js';
import { hash, shorten } from '../util/StringUtils.js';
import { VersionUtils } from '../util/VersionUtils.js';

import type { Driver } from './Driver.js';

/**
 * Common driver utility functions.
 */
export class DriverUtils {
  // -------------------------------------------------------------------------
  // Public Static Methods
  // -------------------------------------------------------------------------

  public static isReleaseVersionOrGreater(
    driver: Driver,
    version: string
  ): boolean {
    return VersionUtils.isGreaterOrEqual(driver.version, version);
  }

  public static isPostgresFamily(driver: Driver): boolean {
    return ['postgres'].includes(driver.options.type);
  }

  /**
   * Normalizes and builds a new driver options.
   * Extracts settings from connection url and sets to a new options object.
   */
  public static buildDriverOptions<
    T extends Record<string, string | number | undefined>,
  >(
    options: T,
    buildOptions?: { useSid: boolean }
  ): {
    url?: string;
    host?: string;
    username?: string;
    password?: string;
    port?: number;
    database?: string;
    sid?: string;
  } {
    if (options.url && typeof options.url === 'string') {
      const urlDriverOptions = this.parseConnectionUrl(options.url) as {
        type?: string;
        host?: string;
        username: string;
        password: string;
        port?: number;
        database?: string;
        sid?: string;
      };

      if (buildOptions && buildOptions.useSid && urlDriverOptions.database) {
        urlDriverOptions.sid = urlDriverOptions.database;
      }

      for (const key of Object.keys(urlDriverOptions)) {
        if (
          typeof urlDriverOptions[key as keyof typeof urlDriverOptions] ===
          'undefined'
        ) {
          delete urlDriverOptions[key as keyof typeof urlDriverOptions];
        }
      }

      return Object.assign({}, options, urlDriverOptions);
    }
    return Object.assign({}, options);
  }
  /**
   * Joins and shortens alias if needed.
   *
   * If the alias length is greater than the limit allowed by the current
   * driver, replaces it with a shortend string, if the shortend string
   * is still too long, it will then hash the alias.
   *
   * @param driver Current `Driver`.
   * @param buildOptions Optional settings.
   * @param alias Alias parts.
   *
   * @return An alias that is no longer than the divers max alias length.
   */
  public static buildAlias(
    { maxAliasLength }: Driver,
    buildOptions: { shorten?: boolean; joiner?: string } | undefined,
    ...alias: Array<string>
  ): string {
    const joiner =
      buildOptions && buildOptions.joiner ? buildOptions.joiner : '_';

    const newAlias = alias.length === 1 ? alias[0] : alias.join(joiner);
    if (!newAlias) throw new ServerError('Alias cannot be empty.');

    if (
      maxAliasLength &&
      maxAliasLength > 0 &&
      newAlias.length > maxAliasLength
    ) {
      if (buildOptions && buildOptions.shorten === true) {
        const shortenedAlias = shorten(newAlias);
        if (shortenedAlias.length < maxAliasLength) {
          return shortenedAlias;
        }
      }

      return hash(newAlias, { length: maxAliasLength });
    }

    return newAlias;
  }

  // -------------------------------------------------------------------------
  // Private Static Methods
  // -------------------------------------------------------------------------

  /**
   * Extracts connection data from the connection url.
   */
  private static parseConnectionUrl(url: string): {
    type?: string;
    host?: string;
    username: string;
    password: string;
    port?: number;
    database?: string;
  } {
    const type = url.split(':')[0];
    const firstSlashes = url.indexOf('//');
    const preBase = url.substr(firstSlashes + 2);
    const secondSlash = preBase.indexOf('/');
    const base = secondSlash !== -1 ? preBase.substr(0, secondSlash) : preBase;
    let afterBase =
      secondSlash !== -1 ? preBase.substr(secondSlash + 1) : undefined;
    // remove mongodb query params
    if (afterBase && afterBase.indexOf('?') !== -1) {
      afterBase = afterBase.substr(0, afterBase.indexOf('?'));
    }

    const lastAtSign = base.lastIndexOf('@');
    const usernameAndPassword = base.substr(0, lastAtSign);
    const hostAndPort = base.substr(lastAtSign + 1);

    let username = usernameAndPassword;
    let password = '';
    const firstColon = usernameAndPassword.indexOf(':');
    if (firstColon !== -1) {
      username = usernameAndPassword.substr(0, firstColon);
      password = usernameAndPassword.substr(firstColon + 1);
    }
    const [host, port] = hostAndPort.split(':');

    return {
      type: type,
      host: host,
      username: decodeURIComponent(username),
      password: decodeURIComponent(password),
      port: port ? parseInt(port) : undefined,
      database: afterBase ?? undefined,
    };
  }
}
