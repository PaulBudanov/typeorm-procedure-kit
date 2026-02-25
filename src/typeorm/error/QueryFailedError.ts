import { ObjectUtils } from '../util/ObjectUtils.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when query execution has failed.
 */
export class QueryFailedError<T extends Error = Error> extends TypeORMError {
  public constructor(
    public readonly query: string,
    public readonly parameters: Array<unknown> | undefined,
    public readonly driverError: T
  ) {
    super(
      driverError
        .toString()
        .replace(/^error: /, '')
        .replace(/^Error: /, '')
        .replace(/^Request/, '')
    );

    if (driverError) {
      const { name: _, ...otherProperties } = driverError;

      ObjectUtils.assign(this, {
        ...otherProperties,
      });
    }
  }
}
