import { getMetadataArgsStorage } from '../../globals.js';
import type { TableMetadataArgs } from '../../metadata-args/TableMetadataArgs.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import type { EntityOptions } from '../options/EntityOptions.js';

/**
 * This decorator is used to mark classes that will be an entity (table or document depend on database type).
 * Database schema will be created for all classes decorated with it, and Repository can be retrieved and used for it.
 */
export function Entity(options?: EntityOptions): ClassDecorator;

/**
 * This decorator is used to mark classes that will be an entity (table or document depend on database type).
 * Database schema will be created for all classes decorated with it, and Repository can be retrieved and used for it.
 */
export function Entity(name?: string, options?: EntityOptions): ClassDecorator;

/**
 * This decorator is used to mark classes that will be an entity (table or document depend on database type).
 * Database schema will be created for all classes decorated with it, and Repository can be retrieved and used for it.
 */
export function Entity(
  nameOrOptions?: string | EntityOptions,
  maybeOptions?: EntityOptions
): ClassDecorator {
  const options =
    (ObjectUtils.isObject(nameOrOptions)
      ? (nameOrOptions as EntityOptions)
      : maybeOptions) || {};
  const name = typeof nameOrOptions === 'string' ? nameOrOptions : options.name;

  return function (target): void {
    getMetadataArgsStorage().tables.push({
      target,
      name,
      type: 'regular',
      orderBy: options.orderBy,
      engine: options.engine,
      database: options.database,
      schema: options.schema,
      synchronize: options.synchronize,
      withoutRowid: options.withoutRowid,
      comment: options.comment,
    } as unknown as TableMetadataArgs);
  };
}
