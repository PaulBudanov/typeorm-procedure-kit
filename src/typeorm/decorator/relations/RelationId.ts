import { getMetadataArgsStorage } from '../../globals.js';
import type { RelationIdMetadataArgs } from '../../metadata-args/RelationIdMetadataArgs.js';
import { SelectQueryBuilder } from '../../query-builder/SelectQueryBuilder.js';

/**
 * Special decorator used to extract relation id into separate entity property.
 *
 * @experimental
 */
export function RelationId<T>(
  relation: string | ((object: T) => unknown),
  alias?: string,
  queryBuilderFactory?: (
    qb: SelectQueryBuilder<unknown>
  ) => SelectQueryBuilder<unknown>
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    getMetadataArgsStorage().relationIds.push({
      target: object.constructor,
      propertyName: propertyName,
      relation: relation,
      alias: alias,
      queryBuilderFactory: queryBuilderFactory,
    } as RelationIdMetadataArgs);
  };
}
