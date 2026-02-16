import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when required driver's package is not installed.
 */
export class DriverPackageNotInstalledError extends TypeORMError {
  public constructor(driverName: string, packageName: string) {
    super(
      `${driverName} package has not been found installed. Please run "npm install ${packageName}".`
    );
  }
}
