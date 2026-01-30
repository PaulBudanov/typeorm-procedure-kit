import { ServerError } from './server-error.js';

export abstract class TypeGuards {
  /**
   * Checks if the given value is either null or undefined.
   * @param value The value to check.
   * @returns True if the value is null or undefined, false otherwise.
   * @example
   * const value = null;
   * console.log(TypeGuards.isNullOrUndefined(value)); // true
   */
  public static isNullOrUndefined(value: unknown): value is null | undefined {
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
  public static isPrimitive(
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
  public static isPlainObject(
    value: unknown
  ): value is Record<string, unknown> {
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
  public static isArray<T>(value: unknown): value is Array<T> {
    return Array.isArray(value);
  }

  /**
   * Checks if the given value is a function.
   * @param value The value to check.
   * @returns True if the value is a function, false otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  public static isFunction(value: unknown): value is Function {
    return typeof value === 'function';
  }

  /**
   * Checks if the given value is a number.
   * Note that this function checks if the value is a number and not NaN.
   * @param value The value to check.
   * @returns True if the value is a number, false otherwise.
   */
  public static isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  }

  /**
   * Checks if the given value is a string.
   * @param value The value to check.
   * @returns True if the value is a string, false otherwise.
   */
  public static isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  /**
   * Checks if the given value is a boolean.
   * @param value The value to check.
   * @returns True if the value is a boolean, false otherwise.
   */
  public static isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
  }

  /**
   * Checks if the given value is a Date object.
   * @param value The value to check.
   * @returns True if the value is a Date object and its time is not NaN, false otherwise.
   */
  public static isDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
  }

  /**
   * Checks if the given value is a RegExp object.
   * @param value The value to check.
   * @returns True if the value is a RegExp object, false otherwise.
   */
  public static isRegExp(value: unknown): value is RegExp {
    return value instanceof RegExp;
  }

  /**
   * Checks if the given value is an Error object.
   * @param value The value to check.
   * @returns True if the value is an Error object, false otherwise.
   */
  public static isError(value: unknown): value is Error {
    return value instanceof Error;
  }

  /**
   * Checks if the given value is a Promise object.
   * @param value The value to check.
   * @returns True if the value is a Promise object, false otherwise.
   * @template T The type of the Promise value.
   */
  public static isPromise<T>(value: unknown): value is Promise<T> {
    return (
      value instanceof Promise ||
      (TypeGuards.isPlainObject(value) &&
        TypeGuards.isFunction(value.then) &&
        TypeGuards.isFunction(value.catch))
    );
  }

  /**
   * Recursively checks if two values are equal.
   * @param a The first value to compare.
   * @param b The second value to compare.
   * @returns True if the two values are equal, false otherwise.
   * @example
   * const obj1 = { a: 1, b: 2 };
   * const obj2 = { a: 1, b: 2 };
   * console.log(TypeGuards.deepEqual(obj1, obj2)); // true
   */
  public static deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    if (TypeGuards.isDate(a) && TypeGuards.isDate(b)) {
      return a.getTime() === b.getTime();
    }

    if (TypeGuards.isRegExp(a) && TypeGuards.isRegExp(b)) {
      return a.toString() === b.toString();
    }

    if (TypeGuards.isArray(a) && TypeGuards.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => TypeGuards.deepEqual(item, b[index]));
    }

    if (TypeGuards.isPlainObject(a) && TypeGuards.isPlainObject(b)) {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      return keysA.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          TypeGuards.deepEqual(a[key], b[key])
      );
    }

    return false;
  }

  /**
   * Recursively clones a value.
   * If the value is a primitive type (string, number, boolean, symbol, bigint), it is returned as is.
   * If the value is a Date object, it is cloned using the Date constructor.
   * If the value is a RegExp object, it is cloned using the RegExp constructor.
   * If the value is an array, it is cloned by recursively cloning each of its elements.
   * If the value is a plain object, it is cloned by recursively cloning each of its properties.
   * For all other types of values, the original value is returned.
   * @param value The value to clone.
   * @returns The cloned value.
   * @template T The type of the value to clone.
   */
  public static clone<T>(value: T): T {
    if (TypeGuards.isPrimitive(value)) {
      return value;
    }

    if (TypeGuards.isDate(value)) {
      return new Date(value.getTime()) as T;
    }

    if (TypeGuards.isRegExp(value)) {
      return new RegExp(value.source, value.flags) as T;
    }

    if (TypeGuards.isArray(value)) {
      return value.map((item) => TypeGuards.clone(item)) as T;
    }

    if (TypeGuards.isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = TypeGuards.clone(val);
      }
      return result as T;
    }
    return value;
  }
}
