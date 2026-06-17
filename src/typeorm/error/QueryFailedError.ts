import { safeStringify } from '../../utils/safe-stringify.js';
import type { QueryParameterValues } from '../driver/QueryParameters.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when query execution has failed.
 */
export class QueryFailedError<T extends Error = Error> extends TypeORMError {
  public readonly query!: string;
  public readonly parameters!: QueryParameterValues | undefined;
  public readonly driverError!: T;

  public constructor(
    query: string,
    parameters: QueryParameterValues | undefined,
    driverError: T
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

    Object.defineProperties(this, {
      query: {
        value: query,
        enumerable: false,
      },
      parameters: {
        value: parameters,
        enumerable: false,
      },
      driverError: {
        value: driverError,
        enumerable: false,
      },
    });
  }

  public get safeParameters(): string | undefined {
    return this.parameters ? safeStringify(this.parameters) : undefined;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      query: this.query,
      parameters: this.safeParameters,
    };
  }
}
