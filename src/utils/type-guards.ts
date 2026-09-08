import { ServerError } from './server-error.js';

class TypeGuardsApi {
  /**
   * Checks if the given value is either null or undefined.
   * @param value The value to check.
   * @returns True if the value is null or undefined, false otherwise.
   * @example
   * const value = null;
   * console.log(TypeGuards.isNullOrUndefined(value)); // true
   */
  public isNullOrUndefined(value: unknown): value is null | undefined {
    return value === null || value === undefined;
  }

  /**
   * Checks if the given value is a primitive type.
   * Primitive types are: string, number, boolean, symbol, bigint.
   * @param value The value to check.
   * @returns True if the value is a primitive type, false otherwise.
   * @example
   * const value = 'hello';
   * console.log(TypeGuards.isPrimitive(value)); // true
   */
  public isPrimitive(
    value: unknown
  ): value is string | number | boolean | symbol | bigint {
    return (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'symbol' ||
      typeof value === 'bigint'
    );
  }

  /**
   * Checks if the given value is a plain object.
   * A plain object is an object that is not an instance of a built-in class
   * such as Array, Date, RegExp, Error, etc.
   * @param value The value to check.
   * @returns True if the value is a plain object, false otherwise.
   * @example
   * const obj = { a: 1, b: 2 };
   * console.log(TypeGuards.isPlainObject(obj)); // true
   */
  public isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp) &&
      !(value instanceof Error) &&
      !(value instanceof ServerError) &&
      !(value instanceof Promise)
    );
  }

  /**
   * Checks if the given value is an array.
   * @param value The value to check.
   * @returns True if the value is an array, false otherwise.
   * @template T The type of the array elements.
   */
  public isArray<T>(value: unknown): value is Array<T> {
    return Array.isArray(value);
  }

  /**
   * Checks if the given value is a Buffer object.
   * @param value The value to check.
   * @returns True if the value is a Buffer object, false otherwise.
   */
  public isBuffer(value: unknown): value is Buffer {
    return Buffer.isBuffer(value);
  }

  /**
   * Checks if the given value is a BigInt.
   * @param value The value to check.
   * @returns True if the value is a BigInt, false otherwise.
   */
  public isBigInt(value: unknown): value is bigint {
    return typeof value === 'bigint';
  }

  /**
   * Checks if the given value is a function.
   * @param value The value to check.
   * @returns True if the value is a function, false otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  public isFunction(value: unknown): value is Function {
    return typeof value === 'function';
  }

  /**
   * Checks if the given value is a number.
   * Note that this function checks if the value is a number and not NaN.
   * @param value The value to check.
   * @returns True if the value is a number, false otherwise.
   */
  public isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  }

  /**
   * Checks if the given value is a string.
   * @param value The value to check.
   * @returns True if the value is a string, false otherwise.
   */
  public isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  /**
   * Checks if the given value is a boolean.
   * @param value The value to check.
   * @returns True if the value is a boolean, false otherwise.
   */
  public isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
  }

  /**
   * Checks if the given value is a Date object.
   * @param value The value to check.
   * @returns True if the value is a Date object and its time is not NaN, false otherwise.
   */
  public isDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
  }

  /**
   * Checks if the given value is a RegExp object.
   * @param value The value to check.
   * @returns True if the value is a RegExp object, false otherwise.
   */
  public isRegExp(value: unknown): value is RegExp {
    return value instanceof RegExp;
  }

  /**
   * Checks if the given value is an Error object.
   * @param value The value to check.
   * @returns True if the value is an Error object, false otherwise.
   */
  public isError(value: unknown): value is Error {
    return value instanceof Error;
  }

  /**
   * Checks if the given value is a Promise object.
   * @param value The value to check.
   * @returns True if the value is a Promise object, false otherwise.
   * @template T The type of the Promise value.
   */
  public isPromise<T>(value: unknown): value is Promise<T> {
    return (
      value instanceof Promise ||
      (this.isPlainObject(value) &&
        this.isFunction(value.then) &&
        this.isFunction(value.catch))
    );
  }
}

const typeGuards = new TypeGuardsApi();

export { typeGuards as TypeGuards };
