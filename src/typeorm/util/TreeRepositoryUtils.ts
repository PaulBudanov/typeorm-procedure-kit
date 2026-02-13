import { EntityManager } from '../entity-manager/EntityManager.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import type { FindTreesOptions } from '../repository/FindTreesOptions.js';

/**
 * Provides utilities for manipulating tree structures.
 *
 */
export class TreeRepositoryUtils {
  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public static createRelationMaps(
    manager: EntityManager,
    metadata: EntityMetadata,
    alias: string,
    rawResults: Array<unknown>
  ): Array<{ id: unknown; parentId: unknown }> {
    return rawResults.map((rawResult) => {
      const joinColumn = metadata.treeParentRelation!.joinColumns[0];
      const referencedColumn =
        joinColumn.referencedColumn ?? metadata.primaryColumns[0];
      // fixes issue #2518, default to databaseName property when givenDatabaseName is not set
      const joinColumnName =
        joinColumn.givenDatabaseName ?? joinColumn.databaseName;
      const referencedColumnName =
        referencedColumn.givenDatabaseName ?? referencedColumn.databaseName;
      const id = rawResult[alias + '_' + referencedColumnName];
      const parentId = rawResult[alias + '_' + joinColumnName];
      return {
        id: manager.connection.driver.prepareHydratedValue(
          id,
          referencedColumn
        ),
        parentId: manager.connection.driver.prepareHydratedValue(
          parentId,
          joinColumn
        ),
      };
    });
  }

  public static buildChildrenEntityTree(
    metadata: EntityMetadata,
    entity: unknown,
    entities: Array<unknown>,
    relationMaps: Array<{ id: unknown; parentId: unknown }>,
    options: FindTreesOptions & { depth: number }
  ): void {
    const childProperty = metadata.treeChildrenRelation!.propertyName;
    if (options.depth === 0) {
      entity[childProperty] = [];
      return;
    }
    const joinColumn = metadata.treeParentRelation!.joinColumns[0];
    const referencedColumn =
      joinColumn.referencedColumn ?? metadata.primaryColumns[0];
    const parentEntityId = referencedColumn.getEntityValue(entity);
    const childRelationMaps = relationMaps.filter(
      (relationMap) => relationMap.parentId === parentEntityId
    );
    const childIds = new Set(
      childRelationMaps.map((relationMap) => relationMap.id)
    );
    entity[childProperty] = entities.filter((entity) =>
      childIds.has(referencedColumn.getEntityValue(entity))
    );
    entity[childProperty].forEach((childEntity: unknown) => {
      TreeRepositoryUtils.buildChildrenEntityTree(
        metadata,
        childEntity,
        entities,
        relationMaps,
        {
          ...options,
          depth: options.depth - 1,
        }
      );
    });
  }

  public static buildParentEntityTree(
    metadata: EntityMetadata,
    entity: unknown,
    entities: Array<unknown>,
    relationMaps: Array<{ id: unknown; parentId: unknown }>
  ): void {
    const parentProperty = metadata.treeParentRelation!.propertyName;
    const joinColumn = metadata.treeParentRelation!.joinColumns[0];
    const referencedColumn =
      joinColumn.referencedColumn ?? metadata.primaryColumns[0];
    const entityId = referencedColumn.getEntityValue(entity);
    const parentRelationMap = relationMaps.find(
      (relationMap) => relationMap.id === entityId
    );
    const parentEntity = entities.find((entity) => {
      if (!parentRelationMap) return false;

      return (
        referencedColumn.getEntityValue(entity) === parentRelationMap.parentId
      );
    });
    if (parentEntity) {
      entity[parentProperty] = parentEntity;
      TreeRepositoryUtils.buildParentEntityTree(
        metadata,
        entity[parentProperty],
        entities,
        relationMaps
      );
    }
  }
}
