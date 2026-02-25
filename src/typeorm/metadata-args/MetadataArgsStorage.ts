import type { TFunction } from '../../types/utility.types.js';
import { MetadataUtils } from '../metadata-builder/MetadataUtils.js';

import type { CheckMetadataArgs } from './CheckMetadataArgs.js';
import type { ColumnMetadataArgs } from './ColumnMetadataArgs.js';
import type { DiscriminatorValueMetadataArgs } from './DiscriminatorValueMetadataArgs.js';
import type { EmbeddedMetadataArgs } from './EmbeddedMetadataArgs.js';
import type { EntityListenerMetadataArgs } from './EntityListenerMetadataArgs.js';
import type { EntityRepositoryMetadataArgs } from './EntityRepositoryMetadataArgs.js';
import type { EntitySubscriberMetadataArgs } from './EntitySubscriberMetadataArgs.js';
import type { ExclusionMetadataArgs } from './ExclusionMetadataArgs.js';
import type { ForeignKeyMetadataArgs } from './ForeignKeyMetadataArgs.js';
import type { GeneratedMetadataArgs } from './GeneratedMetadataArgs.js';
import type { IndexMetadataArgs } from './IndexMetadataArgs.js';
import type { InheritanceMetadataArgs } from './InheritanceMetadataArgs.js';
import type { JoinColumnMetadataArgs } from './JoinColumnMetadataArgs.js';
import type { JoinTableMetadataArgs } from './JoinTableMetadataArgs.js';
import type { NamingStrategyMetadataArgs } from './NamingStrategyMetadataArgs.js';
import type { RelationCountMetadataArgs } from './RelationCountMetadataArgs.js';
import type { RelationIdMetadataArgs } from './RelationIdMetadataArgs.js';
import type { RelationMetadataArgs } from './RelationMetadataArgs.js';
import type { TableMetadataArgs } from './TableMetadataArgs.js';
import type { TransactionEntityMetadataArgs } from './TransactionEntityMetadataArgs.js';
import type { TransactionRepositoryMetadataArgs } from './TransactionRepositoryMetadataArgs.js';
import type { TreeMetadataArgs } from './TreeMetadataArgs.js';
import type { UniqueMetadataArgs } from './UniqueMetadataArgs.js';

/**
 * Storage all metadatas args of all available types: tables, columns, subscribers, relations, etc.
 * Each metadata args represents some specifications of what it represents.
 * MetadataArgs used to create a real Metadata objects.
 */
export class MetadataArgsStorage {
  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  public readonly tables: Array<TableMetadataArgs> = [];
  public readonly trees: Array<TreeMetadataArgs> = [];
  public readonly entityRepositories: Array<EntityRepositoryMetadataArgs> = [];
  public readonly transactionEntityManagers: Array<TransactionEntityMetadataArgs> =
    [];
  public readonly transactionRepositories: Array<TransactionRepositoryMetadataArgs> =
    [];
  public readonly namingStrategies: Array<NamingStrategyMetadataArgs> = [];
  public readonly entitySubscribers: Array<EntitySubscriberMetadataArgs> = [];
  public readonly indices: Array<IndexMetadataArgs> = [];
  public readonly foreignKeys: Array<ForeignKeyMetadataArgs> = [];
  public readonly uniques: Array<UniqueMetadataArgs> = [];
  public readonly checks: Array<CheckMetadataArgs> = [];
  public readonly exclusions: Array<ExclusionMetadataArgs> = [];
  public readonly columns: Array<ColumnMetadataArgs> = [];
  public readonly generations: Array<GeneratedMetadataArgs> = [];
  public readonly relations: Array<RelationMetadataArgs> = [];
  public readonly joinColumns: Array<JoinColumnMetadataArgs> = [];
  public readonly joinTables: Array<JoinTableMetadataArgs> = [];
  public readonly entityListeners: Array<EntityListenerMetadataArgs> = [];
  public readonly relationCounts: Array<RelationCountMetadataArgs> = [];
  public readonly relationIds: Array<RelationIdMetadataArgs> = [];
  public readonly embeddeds: Array<EmbeddedMetadataArgs> = [];
  public readonly inheritances: Array<InheritanceMetadataArgs> = [];
  public readonly discriminatorValues: Array<DiscriminatorValueMetadataArgs> =
    [];

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public filterTables(target: TFunction | string): Array<TableMetadataArgs>;
  public filterTables(
    target: Array<TFunction | string>
  ): Array<TableMetadataArgs>;
  public filterTables(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<TableMetadataArgs> {
    return this.filterByTarget(this.tables, target);
  }

  public filterColumns(target: TFunction | string): Array<ColumnMetadataArgs>;
  public filterColumns(
    target: Array<TFunction | string>
  ): Array<ColumnMetadataArgs>;
  public filterColumns(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<ColumnMetadataArgs> {
    return this.filterByTargetAndWithoutDuplicateProperties(
      this.columns,
      target
    );
  }

  public findGenerated(
    target: TFunction | string,
    propertyName: string
  ): GeneratedMetadataArgs | undefined;
  public findGenerated(
    target: Array<TFunction | string>,
    propertyName: string
  ): GeneratedMetadataArgs | undefined;
  public findGenerated(
    target: (TFunction | string) | Array<TFunction | string>,
    propertyName: string
  ): GeneratedMetadataArgs | undefined {
    return this.generations.find((generated) => {
      return (
        (Array.isArray(target)
          ? target.indexOf(generated.target as TFunction) !== -1
          : generated.target === target) &&
        generated.propertyName === propertyName
      );
    });
  }

  public findTree(
    target: (TFunction | string) | Array<TFunction | string>
  ): TreeMetadataArgs | undefined {
    return this.trees.find((tree) => {
      return Array.isArray(target)
        ? target.indexOf(tree.target as TFunction) !== -1
        : tree.target === target;
    });
  }

  public filterRelations(
    target: TFunction | string
  ): Array<RelationMetadataArgs>;
  public filterRelations(
    target: Array<TFunction | string>
  ): Array<RelationMetadataArgs>;
  public filterRelations(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<RelationMetadataArgs> {
    return this.filterByTargetAndWithoutDuplicateRelationProperties(
      this.relations,
      target
    );
  }

  public filterRelationIds(
    target: TFunction | string
  ): Array<RelationIdMetadataArgs>;
  public filterRelationIds(
    target: Array<TFunction | string>
  ): Array<RelationIdMetadataArgs>;
  public filterRelationIds(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<RelationIdMetadataArgs> {
    return this.filterByTargetAndWithoutDuplicateProperties(
      this.relationIds,
      target
    );
  }

  public filterRelationCounts(
    target: TFunction | string
  ): Array<RelationCountMetadataArgs>;
  public filterRelationCounts(
    target: Array<TFunction | string>
  ): Array<RelationCountMetadataArgs>;
  public filterRelationCounts(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<RelationCountMetadataArgs> {
    return this.filterByTargetAndWithoutDuplicateProperties(
      this.relationCounts,
      target
    );
  }

  public filterIndices(target: TFunction | string): Array<IndexMetadataArgs>;
  public filterIndices(
    target: Array<TFunction | string>
  ): Array<IndexMetadataArgs>;
  public filterIndices(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<IndexMetadataArgs> {
    // todo: implement parent-entity overrides?
    return this.indices.filter((index) => {
      return Array.isArray(target)
        ? target.indexOf(index.target as TFunction) !== -1
        : index.target === target;
    });
  }

  public filterForeignKeys(
    target: TFunction | string
  ): Array<ForeignKeyMetadataArgs>;
  public filterForeignKeys(
    target: Array<TFunction | string>
  ): Array<ForeignKeyMetadataArgs>;
  public filterForeignKeys(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<ForeignKeyMetadataArgs> {
    return this.foreignKeys.filter((foreignKey) => {
      return Array.isArray(target)
        ? target.indexOf(foreignKey.target) !== -1
        : foreignKey.target === target;
    });
  }

  public filterUniques(target: TFunction | string): Array<UniqueMetadataArgs>;
  public filterUniques(
    target: Array<TFunction | string>
  ): Array<UniqueMetadataArgs>;
  public filterUniques(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<UniqueMetadataArgs> {
    return this.uniques.filter((unique) => {
      return Array.isArray(target)
        ? target.indexOf(unique.target as TFunction) !== -1
        : unique.target === target;
    });
  }

  public filterChecks(target: TFunction | string): Array<CheckMetadataArgs>;
  public filterChecks(
    target: Array<TFunction | string>
  ): Array<CheckMetadataArgs>;
  public filterChecks(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<CheckMetadataArgs> {
    return this.checks.filter((check) => {
      return Array.isArray(target)
        ? target.indexOf(check.target as TFunction) !== -1
        : check.target === target;
    });
  }

  public filterExclusions(
    target: TFunction | string
  ): Array<ExclusionMetadataArgs>;
  public filterExclusions(
    target: Array<TFunction | string>
  ): Array<ExclusionMetadataArgs>;
  public filterExclusions(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<ExclusionMetadataArgs> {
    return this.exclusions.filter((exclusion) => {
      return Array.isArray(target)
        ? target.indexOf(exclusion.target as TFunction) !== -1
        : exclusion.target === target;
    });
  }

  public filterListeners(
    target: TFunction | string
  ): Array<EntityListenerMetadataArgs>;
  public filterListeners(
    target: Array<TFunction | string>
  ): Array<EntityListenerMetadataArgs>;
  public filterListeners(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<EntityListenerMetadataArgs> {
    return this.filterByTarget(this.entityListeners, target);
  }

  public filterEmbeddeds(
    target: TFunction | string
  ): Array<EmbeddedMetadataArgs>;
  public filterEmbeddeds(
    target: Array<TFunction | string>
  ): Array<EmbeddedMetadataArgs>;
  public filterEmbeddeds(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<EmbeddedMetadataArgs> {
    return this.filterByTargetAndWithoutDuplicateEmbeddedProperties(
      this.embeddeds,
      target
    );
  }

  public findJoinTable(
    target: TFunction | string,
    propertyName: string
  ): JoinTableMetadataArgs | undefined {
    return this.joinTables.find((joinTable) => {
      return (
        joinTable.target === target && joinTable.propertyName === propertyName
      );
    });
  }

  public filterJoinColumns(
    target: TFunction | string,
    propertyName: string
  ): Array<JoinColumnMetadataArgs> {
    // todo: implement parent-entity overrides?
    return this.joinColumns.filter((joinColumn) => {
      return (
        joinColumn.target === target && joinColumn.propertyName === propertyName
      );
    });
  }

  public filterSubscribers(
    target: TFunction | string
  ): Array<EntitySubscriberMetadataArgs>;
  public filterSubscribers(
    target: Array<TFunction | string>
  ): Array<EntitySubscriberMetadataArgs>;
  public filterSubscribers(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<EntitySubscriberMetadataArgs> {
    return this.filterByTarget(this.entitySubscribers, target);
  }

  public filterNamingStrategies(
    target: TFunction | string
  ): Array<NamingStrategyMetadataArgs>;
  public filterNamingStrategies(
    target: Array<TFunction | string>
  ): Array<NamingStrategyMetadataArgs>;
  public filterNamingStrategies(
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<NamingStrategyMetadataArgs> {
    return this.filterByTarget(this.namingStrategies, target);
  }

  public filterTransactionEntityManagers(
    target: TFunction | string,
    propertyName: string
  ): Array<TransactionEntityMetadataArgs> {
    return this.transactionEntityManagers.filter((transactionEm) => {
      return (
        (Array.isArray(target)
          ? target.indexOf(transactionEm.target) !== -1
          : transactionEm.target === target) &&
        transactionEm.methodName === propertyName
      );
    });
  }

  public filterTransactionRepository(
    target: TFunction | string,
    propertyName: string
  ): Array<TransactionRepositoryMetadataArgs> {
    return this.transactionRepositories.filter((transactionEm) => {
      return (
        (Array.isArray(target)
          ? target.indexOf(transactionEm.target) !== -1
          : transactionEm.target === target) &&
        transactionEm.methodName === propertyName
      );
    });
  }

  public filterSingleTableChildren(
    target: TFunction | string
  ): Array<TableMetadataArgs> {
    return this.tables.filter((table) => {
      return (
        typeof table.target === 'function' &&
        typeof target === 'function' &&
        MetadataUtils.isInherited(table.target, target) &&
        table.type === 'entity-child'
      );
    });
  }

  public findInheritanceType(
    target: TFunction | string
  ): InheritanceMetadataArgs | undefined {
    return this.inheritances.find(
      (inheritance) => inheritance.target === target
    );
  }

  public findDiscriminatorValue(
    target: TFunction | string
  ): DiscriminatorValueMetadataArgs | undefined {
    return this.discriminatorValues.find(
      (discriminatorValue) => discriminatorValue.target === target
    );
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Filters given array by a given target or targets.
   */
  protected filterByTarget<T extends { target: TFunction | string }>(
    array: Array<T>,
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<T> {
    return array.filter((table) => {
      return Array.isArray(target)
        ? target.indexOf(table.target) !== -1
        : table.target === target;
    });
  }

  /**
   * Filters given array by a given target or targets and prevents duplicate property names.
   */
  protected filterByTargetAndWithoutDuplicateProperties<
    T extends {
      target: TFunction | string;
      propertyName: string;
    },
  >(
    array: Array<T>,
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<T> {
    const newArray: Array<T> = [];
    array.forEach((item) => {
      const sameTarget = Array.isArray(target)
        ? target.indexOf(item.target) !== -1
        : item.target === target;
      if (sameTarget) {
        if (
          !newArray.find(
            (newItem) => newItem.propertyName === item.propertyName
          )
        )
          newArray.push(item);
      }
    });
    return newArray;
  }

  /**
   * Filters given array by a given target or targets and prevents duplicate relation property names.
   */
  protected filterByTargetAndWithoutDuplicateRelationProperties<
    T extends RelationMetadataArgs,
  >(
    array: Array<T>,
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<T> {
    const newArray: Array<T> = [];
    array.forEach((item) => {
      const sameTarget = Array.isArray(target)
        ? target.indexOf(item.target as TFunction) !== -1
        : item.target === target;
      if (sameTarget) {
        const existingIndex = newArray.findIndex(
          (newItem) => newItem.propertyName === item.propertyName
        );
        if (
          Array.isArray(target) &&
          existingIndex !== -1 &&
          target.indexOf(item.target as TFunction | string) <
            target.indexOf(
              newArray[existingIndex]?.target as TFunction | string
            )
        ) {
          const clone = Object.create(newArray[existingIndex] as T) as Record<
            string,
            unknown
          >;
          clone.type = item.type;
          newArray[existingIndex] = clone as T;
        } else if (existingIndex === -1) {
          newArray.push(item);
        }
      }
    });
    return newArray;
  }

  /**
   * Filters given array by a given target or targets and prevents duplicate embedded property names.
   */
  protected filterByTargetAndWithoutDuplicateEmbeddedProperties<
    T extends EmbeddedMetadataArgs,
  >(
    array: Array<T>,
    target: (TFunction | string) | Array<TFunction | string>
  ): Array<T> {
    const newArray: Array<T> = [];
    array.forEach((item) => {
      const sameTarget = Array.isArray(target)
        ? target.indexOf(item.target as TFunction) !== -1
        : item.target === target;
      if (sameTarget) {
        const isDuplicateEmbeddedProperty = newArray.find(
          (newItem: EmbeddedMetadataArgs): boolean =>
            newItem.prefix === item.prefix &&
            newItem.propertyName === item.propertyName
        );
        if (!isDuplicateEmbeddedProperty) newArray.push(item);
      }
    });
    return newArray;
  }
}
