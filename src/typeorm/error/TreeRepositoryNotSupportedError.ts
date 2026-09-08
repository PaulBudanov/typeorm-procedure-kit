import { TypeORMError } from './TypeORMError.js';

import type { Driver } from '../driver/Driver.js';

export class TreeRepositoryNotSupportedError extends TypeORMError {
  public constructor(driver: Driver) {
    super(
      `Tree repositories are not supported in ${driver.options.type} driver.`
    );
  }
}
