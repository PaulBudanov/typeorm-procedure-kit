import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when consumer specifies driver type that does not exist or supported.
 */
export class MissingDriverError extends TypeORMError {
  public constructor(driverType: string, availableDrivers: Array<string> = []) {
    super(
      `Wrong driver: "${driverType}" given. Supported drivers are: ` +
        `${availableDrivers.map((d) => `"${d}"`).join(', ')}.`
    );
  }
}
