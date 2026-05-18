import type { ColumnMetadata } from './ColumnMetadata.js';
import type { EntityMetadata } from './EntityMetadata.js';

export type ColumnPathResolutionMode = 'propertyPath' | 'databasePath';

export function resolveColumnPath(
  entityMetadata: EntityMetadata,
  path: string,
  mode: ColumnPathResolutionMode = 'propertyPath'
): Array<ColumnMetadata> {
  if (mode === 'databasePath') {
    const columnWithSameName = entityMetadata.columns.find(
      (column) => column.databasePath === path || column.databaseName === path
    );

    return columnWithSameName ? [columnWithSameName] : [];
  }

  const columnWithSameName = entityMetadata.columns.find(
    (column) => column.propertyPath === path
  );
  if (columnWithSameName) {
    return [columnWithSameName];
  }

  const relationWithSameName = entityMetadata.relations.find(
    (relation) => relation.isWithJoinColumn && relation.propertyName === path
  );
  if (relationWithSameName) {
    return relationWithSameName.joinColumns as Array<ColumnMetadata>;
  }

  return [];
}
