import type {
  ColumnType,
  SimpleColumnType,
  SpatialColumnType,
  UnsignedColumnType,
  WithLengthColumnType,
  WithPrecisionColumnType,
} from '../../driver/types/ColumnTypes.js';
import { ColumnTypeUndefinedError } from '../../error/ColumnTypeUndefinedError.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { EmbeddedMetadataArgs } from '../../metadata-args/EmbeddedMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../../metadata-args/GeneratedMetadataArgs.js';
import type { UniqueMetadataArgs } from '../../metadata-args/UniqueMetadataArgs.js';
import type { ColumnCommonOptions } from '../options/ColumnCommonOptions.js';
import type { ColumnEmbeddedOptions } from '../options/ColumnEmbeddedOptions.js';
import type { ColumnEnumOptions } from '../options/ColumnEnumOptions.js';
import type { ColumnHstoreOptions } from '../options/ColumnHstoreOptions.js';
import type { ColumnNumericOptions } from '../options/ColumnNumericOptions.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';
import type { ColumnUnsignedOptions } from '../options/ColumnUnsignedOptions.js';
import type { ColumnWithLengthOptions } from '../options/ColumnWithLengthOptions.js';
import type { SpatialColumnOptions } from '../options/SpatialColumnOptions.js';

type EmbeddedTypeFunction = (type?: unknown) => unknown;

/**
 * Column decorator is used to mark a specific class property as a table column. Only properties decorated with this
 * decorator will be persisted to the database when entity be saved.
 */
export function Column(): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(options: ColumnOptions): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: SimpleColumnType,
  options?: ColumnCommonOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: SpatialColumnType,
  options?: ColumnCommonOptions & SpatialColumnOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: WithLengthColumnType,
  options?: ColumnCommonOptions & ColumnWithLengthOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: UnsignedColumnType,
  options?: ColumnCommonOptions & ColumnUnsignedOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: WithPrecisionColumnType,
  options?: ColumnCommonOptions & ColumnNumericOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: 'enum',
  options?: ColumnCommonOptions & ColumnEnumOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: 'simple-enum',
  options?: ColumnCommonOptions & ColumnEnumOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: 'set',
  options?: ColumnCommonOptions & ColumnEnumOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  type: 'hstore',
  options?: ColumnOptions & ColumnHstoreOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 *
 * Property in entity can be marked as Embedded, and on persist all columns from the embedded are mapped to the
 * single table of the entity where Embedded is used. And on hydration all columns which supposed to be in the
 * embedded will be mapped to it from the single table.
 */
export function Column(
  type: EmbeddedTypeFunction,
  options?: ColumnEmbeddedOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 */
export function Column(
  typeOrOptions?:
    | EmbeddedTypeFunction
    | ColumnType
    | (ColumnOptions &
        ColumnEmbeddedOptions &
        ColumnHstoreOptions &
        ColumnEnumOptions),
  options?: ColumnOptions &
    ColumnEmbeddedOptions &
    ColumnHstoreOptions &
    ColumnEnumOptions
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    // normalize parameters
    let type: ColumnType | undefined;
    if (
      typeof typeOrOptions === 'string' ||
      typeof typeOrOptions === 'function'
    ) {
      type = typeOrOptions as ColumnType;
    } else if (typeOrOptions) {
      options = typeOrOptions as ColumnOptions;
      type = typeOrOptions.type;
    }
    if (!options) options = {};

    // if type is not given explicitly then try to guess it
    const reflectMetadataType: unknown =
      Reflect && typeof Reflect.getMetadata === 'function'
        ? Reflect.getMetadata('design:type', object, propertyName)
        : undefined;
    if (!type && reflectMetadataType) {
      // if type is not given explicitly then try to guess it
      type = reflectMetadataType as ColumnType;
    }

    // check if there is no type in column options then set type from first function argument, or guessed one
    if (!options.type && type) options.type = type;

    // specify HSTORE type if column is HSTORE
    if (options.type === 'hstore' && !options.hstoreType)
      options.hstoreType = reflectMetadataType === Object ? 'object' : 'string';

    if (typeof typeOrOptions === 'function') {
      // register an embedded
      getMetadataArgsStorage().embeddeds.push({
        target: object.constructor,
        propertyName: propertyName.toString(),
        isArray: reflectMetadataType === Array || options.array === true,
        prefix: options.prefix !== undefined ? options.prefix : undefined,
        type: typeOrOptions as EmbeddedTypeFunction,
      } as EmbeddedMetadataArgs);
    } else {
      // register a regular column

      // if we still don't have a type then we need to give error to user that type is required
      if (!options.type)
        throw new ColumnTypeUndefinedError(object, propertyName.toString());

      // create unique
      if (options.unique === true)
        getMetadataArgsStorage().uniques.push({
          target: object.constructor,
          columns: [propertyName.toString()],
        } as UniqueMetadataArgs);

      getMetadataArgsStorage().columns.push({
        target: object.constructor,
        propertyName: propertyName.toString(),
        mode: 'regular',
        options: options,
      } as ColumnMetadataArgs);

      if (options.generated) {
        getMetadataArgsStorage().generations.push({
          target: object.constructor,
          propertyName: propertyName.toString(),
          strategy:
            typeof options.generated === 'string'
              ? options.generated
              : 'increment',
        } as GeneratedMetadataArgs);
      }
    }
  };
}
