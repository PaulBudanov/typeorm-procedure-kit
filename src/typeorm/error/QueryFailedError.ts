import { TypeORMError } from './TypeORMError.js';

import type { QueryParameterValues } from '../driver/QueryParameters.js';

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
      for (const property of Reflect.ownKeys(driverError)) {
        if (
          property === 'name' ||
          property === 'message' ||
          property === 'stack' ||
          property === 'query' ||
          property === 'parameters' ||
          property === 'driverError'
        ) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          driverError,
          property
        );
        if (!descriptor?.enumerable) continue;
        Object.defineProperty(this, property, {
          ...descriptor,
          enumerable: false,
        });
      }
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
    if (!this.parameters) return undefined;
    return Array.isArray(this.parameters)
      ? `${this.parameters.length} positional value(s)`
      : `${Object.keys(this.parameters).length} named value(s)`;
  }

  public toJSON(): Record<string, unknown> {
    const driverCode = (this.driverError as Error & { code?: unknown }).code;
    return {
      name: this.name,
      message: 'Database query failed',
      ...(typeof driverCode === 'string' || typeof driverCode === 'number'
        ? { code: driverCode }
        : {}),
    };
  }
}
