import { existsSync } from 'fs';
import { createRequire } from 'module';
import { extname, normalize, resolve } from 'path';

import dotenv from 'dotenv';

export { EventEmitter } from 'events';
export { ReadStream } from 'fs';
export { Readable, Writable } from 'stream';

function getCurrentModuleLocation(): string {
  if (typeof __filename === 'string') return __filename;

  const originalPrepareStackTrace = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_error, callSites): Array<NodeJS.CallSite> =>
      callSites;
    const error = new Error();
    Error.captureStackTrace(error, getCurrentModuleLocation);
    const callSites = error.stack as unknown as Array<NodeJS.CallSite>;
    const moduleLocation = callSites[0]?.getFileName();
    if (!moduleLocation) {
      throw new TypeError(
        'Unable to resolve the PlatformTools module location'
      );
    }
    return moduleLocation;
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
}

// Driver construction is synchronous, so optional peer dependencies must be
// resolved synchronously as well. Anchor resolution to this installed module,
// not to the consumer entry point or cwd. This works in both generated ESM and
// CommonJS builds and supports nested package-manager topologies.
const platformRequire = createRequire(getCurrentModuleLocation());

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

  public static load(name: string): unknown {
    try {
      switch (name) {
        /**
         * oracle
         */
        case 'oracledb':
          return platformRequire('oracledb');

        /**
         * postgres
         */
        case 'pg':
          return platformRequire('pg');
        case 'pg-native':
          return platformRequire('pg-native');
        case 'pg-query-stream':
          return platformRequire('pg-query-stream');
      }
    } catch (error: unknown) {
      throw new TypeError(`Invalid Package for PlatformTools.load: ${name}`, {
        cause: error,
      });
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
}
