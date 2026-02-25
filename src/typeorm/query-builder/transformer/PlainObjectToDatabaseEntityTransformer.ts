import type { TFunction } from '../../../types/utility.types.js';
import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import { EntityManager } from '../../entity-manager/EntityManager.js';
import { EntityMetadata } from '../../metadata/EntityMetadata.js';
import { RelationMetadata } from '../../metadata/RelationMetadata.js';

/**
 */
class LoadMapItem {
  public entity?: ObjectLiteral;
  public plainEntity: ObjectLiteral;
  public metadata: EntityMetadata;
  public parentLoadMapItem?: LoadMapItem;
  public relation?: RelationMetadata;

  public constructor(
    plainEntity: ObjectLiteral,
    metadata: EntityMetadata,
    parentLoadMapItem?: LoadMapItem,
    relation?: RelationMetadata
  ) {
    this.plainEntity = plainEntity;
    this.metadata = metadata;
    this.parentLoadMapItem = parentLoadMapItem;
    this.relation = relation;
  }

  public get target(): TFunction | string {
    return this.metadata.target;
  }

  public get id(): ObjectLiteral | string | undefined {
    return this.metadata.getEntityIdMixedMap(this.plainEntity);
  }
}

class LoadMap {
  public loadMapItems: Array<LoadMapItem> = [];

  public get mainLoadMapItem(): LoadMapItem | undefined {
    return this.loadMapItems.find(
      (item) => !item.relation && !item.parentLoadMapItem
    );
  }

  public addLoadMap(newLoadMap: LoadMapItem): void {
    const item = this.loadMapItems.find(
      (item) => item.target === newLoadMap.target && item.id === newLoadMap.id
    );
    if (!item) this.loadMapItems.push(newLoadMap);
  }

  public fillEntities(
    target: TFunction | string,
    entities: Array<ObjectLiteral>
  ): void {
    entities.forEach((entity) => {
      const item = this.loadMapItems.find((loadMapItem) => {
        return (
          loadMapItem.target === target &&
          loadMapItem.metadata.compareEntities(entity, loadMapItem.plainEntity)
        );
      });
      if (item) item.entity = entity;
    });
  }

  public groupByTargetIds(): Array<{
    target: TFunction | string;
    ids: Array<unknown>;
  }> {
    const groups: Array<{ target: TFunction | string; ids: Array<unknown> }> =
      [];
    this.loadMapItems.forEach((loadMapItem) => {
      let group = groups.find((group) => group.target === loadMapItem.target);
      if (!group) {
        group = { target: loadMapItem.target, ids: [] };
        groups.push(group);
      }

      group.ids.push(loadMapItem.id);
    });
    return groups;
  }
}

/**
 * Transforms plain old javascript object
 * Entity is constructed based on its entity metadata.
 */
export class PlainObjectToDatabaseEntityTransformer {
  public constructor(private manager: EntityManager) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public async transform(
    plainObject: ObjectLiteral,
    metadata: EntityMetadata
  ): Promise<ObjectLiteral | undefined> {
    // if plain object does not have id then nothing to load really
    if (!metadata.hasAllPrimaryKeys(plainObject))
      return Promise.reject(
        'Given object does not have a primary column, cannot transform it to database entity.'
      );

    // create a special load map that will hold all metadata that will be used to operate with entities easily
    const loadMap = new LoadMap();
    const fillLoadMap = (
      entity: ObjectLiteral,
      entityMetadata: EntityMetadata,
      parentLoadMapItem?: LoadMapItem,
      relation?: RelationMetadata
    ): void => {
      const item = new LoadMapItem(
        entity,
        entityMetadata,
        parentLoadMapItem,
        relation
      );
      loadMap.addLoadMap(item);

      entityMetadata
        .extractRelationValuesFromEntity(entity, metadata.relations)
        .filter((value) => value !== null && value !== undefined)
        .forEach(([relation, value, inverseEntityMetadata]) =>
          fillLoadMap(
            value as ObjectLiteral,
            inverseEntityMetadata,
            item,
            relation
          )
        );
    };
    fillLoadMap(plainObject, metadata);
    // load all entities and store them in the load map
    await Promise.all(
      loadMap.groupByTargetIds().map((targetWithIds) => {
        // todo: fix type hinting
        return this.manager
          .findByIds<ObjectLiteral>(targetWithIds.target, targetWithIds.ids)
          .then((entities) =>
            loadMap.fillEntities(targetWithIds.target, entities)
          );
      })
    );

    // go through each item in the load map and set their entity relationship using metadata stored in load map
    loadMap.loadMapItems.forEach((loadMapItem) => {
      if (
        !loadMapItem.relation ||
        !loadMapItem.entity ||
        !loadMapItem.parentLoadMapItem ||
        !loadMapItem.parentLoadMapItem.entity
      )
        return;

      if (
        loadMapItem.relation.isManyToMany ||
        loadMapItem.relation.isOneToMany
      ) {
        if (
          !loadMapItem.parentLoadMapItem.entity[
            loadMapItem.relation.propertyName
          ]
        )
          loadMapItem.parentLoadMapItem.entity[
            loadMapItem.relation.propertyName
          ] = [];
        (
          loadMapItem.parentLoadMapItem.entity[
            loadMapItem.relation.propertyName
          ] as Array<ObjectLiteral>
        ).push(loadMapItem.entity);
      } else {
        loadMapItem.parentLoadMapItem.entity[
          loadMapItem.relation.propertyName
        ] = loadMapItem.entity;
      }
    });

    return loadMap.mainLoadMapItem ? loadMap.mainLoadMapItem.entity : undefined;
  }
}
