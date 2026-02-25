import type { DeepPartial } from '../common/DeepPartial.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type {
  PrimitiveCriteria,
  SinglePrimitiveCriteria,
} from '../common/PrimitiveCriteria.js';

export class OrmUtils {
  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  /**
   * Chunks array into pieces.
   */
  public static chunk<T>(
    array: ReadonlyArray<T>,
    size: number
  ): Array<Array<T>> {
    return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
      array.slice(i * size, i * size + size)
    );
  }

  public static splitClassesAndStrings<T>(
    classesAndStrings: Array<string | T>
  ): [Array<T>, Array<string>] {
    return [
      classesAndStrings.filter((cls): cls is T => typeof cls !== 'string'),
      classesAndStrings.filter((str): str is string => typeof str === 'string'),
    ];
  }

  public static groupBy<T, R>(
    array: ReadonlyArray<T>,
    propertyCallback: (item: T) => R
  ): Array<{ id: R; items: Array<T> }> {
    return array.reduce(
      (groupedArray, value) => {
        const key = propertyCallback(value);
        const grouped = groupedArray.find((i) => i.id === key);
        if (grouped === undefined) {
          groupedArray.push({ id: key, items: [value] });
        } else {
          grouped.items.push(value);
        }
        return groupedArray;
      },
      [] as Array<{ id: R; items: Array<T> }>
    );
  }

  public static uniq<T, K extends keyof T>(
    array: ReadonlyArray<T>,
    criteriaOrProperty?: ((item: T) => unknown) | K
  ): Array<T> {
    return array.reduce((uniqueArray, item) => {
      let found = false;
      if (typeof criteriaOrProperty === 'function') {
        const itemValue = criteriaOrProperty(item);
        found = uniqueArray.some(
          (uniqueItem) => criteriaOrProperty(uniqueItem) === itemValue
        );
      } else if (typeof criteriaOrProperty === 'string') {
        found = uniqueArray.some(
          (uniqueItem) =>
            uniqueItem[criteriaOrProperty] === item[criteriaOrProperty]
        );
      } else {
        found = uniqueArray.includes(item);
      }

      if (!found) uniqueArray.push(item);

      return uniqueArray;
    }, [] as Array<T>);
  }

  /**
   * Deep Object.assign.
   */
  public static mergeDeep<T>(
    target: T,
    ...sources: Array<DeepPartial<T> | undefined>
  ): T {
    if (!sources.length) {
      return target;
    }

    for (const source of sources) {
      OrmUtils.merge(target, source);
    }

    return target;
  }

  /**
   * Creates a shallow copy of the object, without invoking the constructor
   */
  public static cloneObject<T extends object>(object: T): T {
    if (object === null || object === undefined) {
      return object;
    }

    return Object.assign(
      Object.create(Object.getPrototypeOf(object) as object) as T,
      object
    );
  }

  /**
   * Deep compare objects.
   *
   * @see http://stackoverflow.com/a/1144249
   */
  public static deepCompare<T>(...args: Array<T>): boolean {
    let i: number,
      l: number,
      leftChain: Array<unknown>,
      rightChain: Array<unknown>;

    if (args.length < 1) {
      return true; // Die silently? Don't know how to handle such case, please help...
      // throw "Need two or more arguments to compare";
    }

    for (i = 1, l = args.length; i < l; i++) {
      leftChain = []; // Todo: this can be cached
      rightChain = [];

      if (!OrmUtils.compare2Objects(leftChain, rightChain, args[0], args[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Gets deeper value of object.
   */
  public static deepValue(obj: ObjectLiteral, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
      return (current as ObjectLiteral)?.[segment];
    }, obj);
  }

  public static replaceEmptyObjectsWithBooleans(
    obj: Record<string, unknown>
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object') {
        const recordValue = value as Record<string, unknown>;
        if (Object.keys(recordValue).length === 0) {
          obj[key] = true;
        } else {
          OrmUtils.replaceEmptyObjectsWithBooleans(recordValue);
        }
      }
    }
  }

  public static propertyPathsToTruthyObject(
    paths: Array<string>
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const path of paths) {
      const props = path.split('.');
      if (!props.length) continue;

      if (!obj[props[0]!] || obj[props[0]!] === true) {
        obj[props[0]!] = {};
      }
      let recursiveChild: unknown = obj[props[0]!];
      for (const [key, prop] of props.entries()) {
        if (key === 0) continue;

        if (
          recursiveChild &&
          typeof recursiveChild === 'object' &&
          prop in recursiveChild
        ) {
          recursiveChild = (recursiveChild as Record<string, unknown>)[prop];
        } else if (key === props.length - 1) {
          (recursiveChild as Record<string, unknown>)[prop] = {};
          recursiveChild = null;
        } else {
          (recursiveChild as Record<string, unknown>)[prop] = {};
          recursiveChild = (recursiveChild as Record<string, unknown>)[prop];
        }
      }
    }
    OrmUtils.replaceEmptyObjectsWithBooleans(obj);
    return obj;
  }

  /**
   * Check if two entity-id-maps are the same
   */
  public static compareIds(
    firstId: ObjectLiteral | undefined,
    secondId: ObjectLiteral | undefined
  ): boolean {
    if (
      firstId === undefined ||
      firstId === null ||
      secondId === undefined ||
      secondId === null
    )
      return false;

    // Optimized version for the common case
    if (
      ((typeof firstId.id === 'string' && typeof secondId.id === 'string') ||
        (typeof firstId.id === 'number' && typeof secondId.id === 'number')) &&
      Object.keys(firstId).length === 1 &&
      Object.keys(secondId).length === 1
    ) {
      return firstId.id === secondId.id;
    }

    return OrmUtils.deepCompare(firstId, secondId);
  }

  /**
   * Transforms given value into boolean value.
   */
  public static toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === '1';
    if (typeof value === 'number') return value > 0;
    return false;
  }

  /**
   * Checks if two arrays of unique values contain the same values
   */
  public static isArraysEqual<T>(
    arr1: ReadonlyArray<T>,
    arr2: ReadonlyArray<T>
  ): boolean {
    if (arr1.length !== arr2.length) {
      return false;
    }

    return arr1.every((element) => arr2.includes(element));
  }

  public static areMutuallyExclusive<T>(...lists: Array<Array<T>>): boolean {
    const haveSharedObjects = lists.some((list) => {
      const otherLists = lists.filter((otherList) => otherList !== list);
      return list.some((item) =>
        otherLists.some((otherList) => otherList.includes(item))
      );
    });
    return !haveSharedObjects;
  }

  /**
   * Parses the CHECK constraint on the specified column and returns
   * all values allowed by the constraint or undefined if the constraint
   * is not present.
   */
  public static parseSqlCheckExpression(
    sql: string,
    columnName: string
  ): Array<string> | undefined {
    const enumMatch = sql.match(
      new RegExp(
        `"${columnName}" varchar CHECK\\s*\\(\\s*"${columnName}"\\s+IN\\s*`
      )
    );

    if (enumMatch && enumMatch.index) {
      const afterMatch = sql.substring(enumMatch.index + enumMatch[0].length);

      // This is an enum
      // all enum values stored as a comma separated list
      const chars = afterMatch;

      /**
       * * When outside quotes: empty string
       * * When inside single quotes: `'`
       */
      let currentQuotes = '';
      let nextValue = '';
      const enumValues: Array<string> = [];
      for (let idx = 0; idx < chars.length; idx++) {
        const char = chars[idx];
        switch (char) {
          case ',':
            if (currentQuotes == '') {
              enumValues.push(nextValue);
              nextValue = '';
            } else {
              nextValue += char;
            }
            break;
          case "'":
            if (currentQuotes == char) {
              const isNextCharQuote = chars[idx + 1] === char;
              if (isNextCharQuote) {
                // double quote in sql should be treated as a
                // single quote that's part of the quoted string
                nextValue += char;
                idx += 1; // skip that next quote
              } else {
                currentQuotes = '';
              }
            } else {
              currentQuotes = char;
            }
            break;
          case ')':
            if (currentQuotes == '') {
              enumValues.push(nextValue);
              return enumValues;
            } else {
              nextValue += char;
            }
            break;
          default:
            if (currentQuotes != '') {
              nextValue += char;
            }
        }
      }
    }
    return undefined;
  }

  /**
   * Checks if given criteria is null or empty.
   */
  public static isCriteriaNullOrEmpty(criteria: unknown): boolean {
    return (
      criteria === undefined ||
      criteria === null ||
      criteria === '' ||
      (Array.isArray(criteria) && criteria.length === 0) ||
      (OrmUtils.isPlainObject(criteria) && Object.keys(criteria).length === 0)
    );
  }

  /**
   * Checks if given criteria is a primitive value.
   * Primitive values are strings, numbers and dates.
   */
  public static isSinglePrimitiveCriteria(
    criteria: unknown
  ): criteria is SinglePrimitiveCriteria {
    return (
      typeof criteria === 'string' ||
      typeof criteria === 'number' ||
      criteria instanceof Date
    );
  }

  /**
   * Checks if given criteria is a primitive value or an array of primitive values.
   */
  public static isPrimitiveCriteria(
    criteria: unknown
  ): criteria is PrimitiveCriteria {
    if (Array.isArray(criteria)) {
      return criteria.every((value) =>
        OrmUtils.isSinglePrimitiveCriteria(value)
      );
    }

    return OrmUtils.isSinglePrimitiveCriteria(criteria);
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  private static compare2Objects(
    leftChain: Array<unknown>,
    rightChain: Array<unknown>,
    x: unknown,
    y: unknown
  ): boolean {
    // remember that NaN === NaN returns false
    // and isNaN(undefined) returns true
    if (Number.isNaN(x) && Number.isNaN(y)) return true;

    // Compare primitives and functions.
    // Check if both arguments link to the same object.
    // Especially useful on the step where we compare prototypes
    if (x === y) return true;

    // Unequal, but either is null or undefined (use case: jsonb comparison)
    // PR #3776, todo: add tests
    if (x === null || y === null || x === undefined || y === undefined)
      return false;

    // Fix the buffer compare bug.
    // See: https://github.com/typeorm/typeorm/issues/3654
    if (
      (typeof x === 'object' &&
        x !== null &&
        'equals' in x &&
        typeof x.equals === 'function') ||
      (typeof y === 'object' &&
        y !== null &&
        'equals' in y &&
        typeof y.equals === 'function')
    ) {
      const xObj = x as { equals: (other: unknown) => boolean };
      const yObj = y as { equals: (other: unknown) => boolean };
      if (xObj.equals(y) || yObj.equals(x)) {
        return true;
      }
    }

    // Works in case when functions are created in constructor.
    // Comparing dates is a common scenario. Another built-ins?
    // We can even handle functions passed across iframes
    if (
      (typeof x === 'function' && typeof y === 'function') ||
      (x instanceof Date && y instanceof Date) ||
      (x instanceof RegExp && y instanceof RegExp) ||
      (typeof x === 'string' && typeof y === 'string') ||
      (typeof x === 'number' && typeof y === 'number')
    ) {
      return String(x) === String(y);
    }

    // At last checking prototypes as good as we can
    if (
      !(
        typeof x === 'object' &&
        typeof y === 'object' &&
        x !== null &&
        y !== null
      )
    ) {
      return false;
    }

    if (
      Object.prototype.isPrototypeOf.call(x, y) ||
      Object.prototype.isPrototypeOf.call(y, x)
    ) {
      return false;
    }

    if (
      (x as Record<string, unknown>).constructor !==
      (y as Record<string, unknown>).constructor
    ) {
      return false;
    }

    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;

    // Check for infinitive linking loops
    if (leftChain.includes(x) || rightChain.includes(y)) return false;

    // Quick checking of one object being a subset of another.
    // todo: cache the structure of arguments[0] for performance
    const xRecord = x as Record<string, unknown>;
    const yRecord = y as Record<string, unknown>;

    for (const p of Object.keys(yRecord)) {
      if (
        Object.prototype.hasOwnProperty.call(yRecord, p) !==
        Object.prototype.hasOwnProperty.call(xRecord, p)
      ) {
        return false;
      }
      if (typeof yRecord[p] !== typeof xRecord[p]) {
        return false;
      }
    }

    for (const p of Object.keys(xRecord)) {
      if (
        Object.prototype.hasOwnProperty.call(yRecord, p) !==
        Object.prototype.hasOwnProperty.call(xRecord, p)
      ) {
        return false;
      }
      if (typeof yRecord[p] !== typeof xRecord[p]) {
        return false;
      }

      switch (typeof xRecord[p]) {
        case 'object':
        case 'function':
          leftChain.push(x);
          rightChain.push(y);

          if (
            !OrmUtils.compare2Objects(
              leftChain,
              rightChain,
              xRecord[p],
              yRecord[p]
            )
          ) {
            return false;
          }

          leftChain.pop();
          rightChain.pop();
          break;

        default:
          if (xRecord[p] !== yRecord[p]) {
            return false;
          }
          break;
      }
    }

    return true;
  }

  // Checks if it's an object made by Object.create(null), {} or new Object()
  private static isPlainObject(item: unknown): boolean {
    if (item === null || item === undefined) {
      return false;
    }

    return (
      !(item as Record<string, unknown>).constructor ||
      (item as Record<string, unknown>).constructor === Object
    );
  }

  private static mergeArrayKey(
    target: Array<unknown>,
    key: number,
    value: unknown,
    memo: Map<unknown, unknown>
  ): void {
    // Have we seen this before?  Prevent infinite recursion.
    if (memo.has(value)) {
      target[key] = memo.get(value);
      return;
    }

    if (value instanceof Promise) {
      // Skip promises entirely.
      // This is a hold-over from the old code & is because we don't want to pull in
      // the lazy fields.  Ideally we'd remove these promises via another function first
      // but for now we have to do it here.
      return;
    }

    if (!OrmUtils.isPlainObject(value) && !Array.isArray(value)) {
      target[key] = value;
      return;
    }

    if (!target[key]) {
      target[key] = Array.isArray(value) ? [] : {};
    }

    memo.set(value, target[key]);
    OrmUtils.merge(target[key], value, memo);
    memo.delete(value);
  }

  private static mergeObjectKey(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
    memo: Map<unknown, unknown>
  ): void {
    // Have we seen this before?  Prevent infinite recursion.
    if (memo.has(value)) {
      Object.assign(target, { [key]: memo.get(value) });
      return;
    }

    if (value instanceof Promise) {
      // Skip promises entirely.
      // This is a hold-over from the old code & is because we don't want to pull in
      // the lazy fields.  Ideally we'd remove these promises via another function first
      // but for now we have to do it here.
      return;
    }

    if (!OrmUtils.isPlainObject(value) && !Array.isArray(value)) {
      Object.assign(target, { [key]: value });
      return;
    }

    if (!target[key]) {
      Object.assign(target, { [key]: Array.isArray(value) ? [] : {} });
    }

    memo.set(value, target[key]);
    OrmUtils.merge(target[key], value, memo);
    memo.delete(value);
  }

  private static merge<T>(
    target: T,
    source: DeepPartial<T> | undefined,
    memo = new Map<unknown, unknown>()
  ): void {
    if (OrmUtils.isPlainObject(target) && OrmUtils.isPlainObject(source)) {
      for (const [key, value] of Object.entries(source as ObjectLiteral)) {
        if (key === '__proto__') continue;
        OrmUtils.mergeObjectKey(
          target as Record<string, unknown>,
          key,
          value,
          memo
        );
      }
    }

    if (Array.isArray(target) && Array.isArray(source)) {
      for (let key = 0; key < source.length; key++) {
        OrmUtils.mergeArrayKey(target, key, source[key], memo);
      }
    }
  }
}
