import type { ColumnMetadata } from './ColumnMetadata.js';
import type { EntityMetadata } from './EntityMetadata.js';

export type ColumnPathResolutionMode =
  | 'propertyPath'
  | 'databasePath'
  | 'propertyOrDatabasePath';

export function resolveColumnPath<Entity>(
  entityMetadata: EntityMetadata<Entity>,
  path: string,
  mode: ColumnPathResolutionMode = 'propertyPath'
): Array<ColumnMetadata> {
  const propertyColumn = entityMetadata.columns.find(
    (column) => column.propertyPath === path
  );
  if (mode !== 'databasePath' && propertyColumn) return [propertyColumn];

  const relationWithSameName = entityMetadata.relations.find(
    (relation) =>
      relation.isWithJoinColumn &&
      (relation.propertyPath === path || relation.propertyName === path)
  );

  if (mode !== 'databasePath' && relationWithSameName) {
    return relationWithSameName.joinColumns as Array<ColumnMetadata>;
  }

  if (mode !== 'propertyPath') {
    const databaseColumn = entityMetadata.columns.find(
      (column) => column.databasePath === path || column.databaseName === path
    );

    if (databaseColumn) return [databaseColumn];
  }

  return [];
}
