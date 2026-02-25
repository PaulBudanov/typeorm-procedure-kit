import type { MixedList } from '../common/MixedList.js';

export class ObjectUtils {
  /**
   * Checks if given value is an object.
   * We cannot use instanceof because it has problems when running on different contexts.
   * And we don't simply use typeof because typeof null === "object".
   */
  public static isObject(val: unknown): val is object {
    return val !== null && typeof val === 'object';
  }

  /**
   * Checks if given value is an object.
   * We cannot use instanceof because it has problems when running on different contexts.
   * And we don't simply use typeof because typeof null === "object".
   */
  public static isObjectWithName(
    val: unknown
  ): val is object & { name: string } {
    return (
      val !== null &&
      typeof val === 'object' &&
      (val as Record<string, unknown>)['name'] !== undefined
    );
  }

  /**
   * Copy the values of all of the enumerable own properties from one or more source objects to a
   * target object.
   * @param target The target object to copy to.
   * @param source The source object from which to copy properties.
   */
  public static assign<T, U>(target: T, source: U): void;

  /**
   * Copy the values of all of the enumerable own properties from one or more source objects to a
   * target object.
   * @param target The target object to copy to.
   * @param source1 The first source object from which to copy properties.
   * @param source2 The second source object from which to copy properties.
   */
  public static assign<T, U, V>(target: T, source1: U, source2: V): void;

  /**
   * Copy the values of all of the enumerable own properties from one or more source objects to a
   * target object.
   * @param target The target object to copy to.
   * @param source1 The first source object from which to copy properties.
   * @param source2 The second source object from which to copy properties.
   * @param source3 The third source object from which to copy properties.
   */
  public static assign<T, U, V, W>(
    target: T,
    source1: U,
    source2: V,
    source3: W
  ): void;

  /**
   * Copy the values of all of the enumerable own properties from one or more source objects to a
   * target object.
   * @param target The target object to copy to.
   * @param sources One or more source objects from which to copy properties
   */
  public static assign(target: object, ...sources: Array<unknown>): void {
    for (const source of sources) {
      for (const prop of Object.getOwnPropertyNames(source)) {
        (target as Record<string, unknown>)[prop] = (
          source as Record<string, unknown>
        )[prop];
      }
    }
  }

  /**
   * Converts MixedList<T> to strictly an array of its T items.
   */
  public static mixedListToArray<T>(list: MixedList<T>): Array<T> {
    if (list !== null && typeof list === 'object') {
      return Object.keys(list).map(
        (key) => (list as Record<string, T>)[key]
      ) as Array<T>;
    } else {
      return list as Array<T>;
    }
  }
}
