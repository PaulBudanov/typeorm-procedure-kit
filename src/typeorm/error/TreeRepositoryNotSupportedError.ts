import type { Driver } from '../driver/Driver.js';

import { TypeORMError } from './TypeORMError.js';

export class TreeRepositoryNotSupportedError extends TypeORMError {
  public constructor(driver: Driver) {
    super(
      `Tree repositories are not supported in ${driver.options.type} driver.`
    );
  }
}
