import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { RelationCountMetadataArgs } from '../../metadata-args/RelationCountMetadataArgs.js';
import type { SelectQueryBuilder } from '../../query-builder/SelectQueryBuilder.js';

/**
 * Holds a number of children in the closure table of the column.
 *
 * @deprecated This decorator will removed in the future versions.
 * Use {@link VirtualColumn} to calculate the count instead.
 */
export function RelationCount<T>(
  relation: string | ((object: T) => unknown),
  alias?: string,
  queryBuilderFactory?: (
    qb: SelectQueryBuilder<ObjectLiteral>
  ) => SelectQueryBuilder<ObjectLiteral>
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    getMetadataArgsStorage().relationCounts.push({
      target: object.constructor,
      propertyName: propertyName,
      relation: relation,
      alias: alias,
      queryBuilderFactory: queryBuilderFactory,
    } as unknown as RelationCountMetadataArgs);
  };
}
