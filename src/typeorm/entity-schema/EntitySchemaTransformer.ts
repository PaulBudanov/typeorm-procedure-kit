import type { JoinTableMultipleColumnsOptions } from '../decorator/options/JoinTableMultipleColumnsOptions.js';
import type { JoinTableOptions } from '../decorator/options/JoinTableOptions.js';
import type { CheckMetadataArgs } from '../metadata-args/CheckMetadataArgs.js';
import type { ColumnMetadataArgs } from '../metadata-args/ColumnMetadataArgs.js';
import type { ExclusionMetadataArgs } from '../metadata-args/ExclusionMetadataArgs.js';
import type { ForeignKeyMetadataArgs } from '../metadata-args/ForeignKeyMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../metadata-args/GeneratedMetadataArgs.js';
import type { IndexMetadataArgs } from '../metadata-args/IndexMetadataArgs.js';
import type { InheritanceMetadataArgs } from '../metadata-args/InheritanceMetadataArgs.js';
import type { JoinColumnMetadataArgs } from '../metadata-args/JoinColumnMetadataArgs.js';
import type { JoinTableMetadataArgs } from '../metadata-args/JoinTableMetadataArgs.js';
import { MetadataArgsStorage } from '../metadata-args/MetadataArgsStorage.js';
import type { RelationIdMetadataArgs } from '../metadata-args/RelationIdMetadataArgs.js';
import type { RelationMetadataArgs } from '../metadata-args/RelationMetadataArgs.js';
import type { TableMetadataArgs } from '../metadata-args/TableMetadataArgs.js';
import type { ColumnMode } from '../metadata-args/types/ColumnMode.js';
import type { UniqueMetadataArgs } from '../metadata-args/UniqueMetadataArgs.js';

import { EntitySchema } from './EntitySchema.js';
import type { EntitySchemaColumnOptions } from './EntitySchemaColumnOptions.js';
import type { EntitySchemaEmbeddedColumnOptions } from './EntitySchemaEmbeddedColumnOptions.js';
import { EntitySchemaEmbeddedError } from './EntitySchemaEmbeddedError.js';
import { EntitySchemaOptions } from './EntitySchemaOptions.js';
import type { EntitySchemaRelationIdOptions } from './EntitySchemaRelationIdOptions.js';
import type { EntitySchemaRelationOptions } from './EntitySchemaRelationOptions.js';

/**
 * Transforms entity schema into metadata args storage.
 * The result will be just like entities read from decorators.
 */
export class EntitySchemaTransformer {
  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Transforms entity schema into new metadata args storage object.
   */
  public transform(schemas: Array<EntitySchema<unknown>>): MetadataArgsStorage {
    const metadataArgsStorage = new MetadataArgsStorage();

    schemas.forEach((entitySchema) => {
      const options = entitySchema.options;

      // add table metadata args from the schema
      const tableMetadata: TableMetadataArgs = {
        target: options.target || options.name,
        name: options.tableName,
        database: options.database,
        schema: options.schema,
        type: options.type || 'regular',
        orderBy: options.orderBy,
        synchronize: options.synchronize,
        withoutRowid: !!options.withoutRowid,
        expression: options.expression,
      };
      metadataArgsStorage.tables.push(tableMetadata);

      const { inheritance } = options;

      if (inheritance) {
        metadataArgsStorage.inheritances.push({
          target: options.target,
          pattern: inheritance.pattern ?? 'STI',
          column: inheritance.column
            ? typeof inheritance.column === 'string'
              ? { name: inheritance.column }
              : inheritance.column
            : undefined,
        } as InheritanceMetadataArgs);
      }

      const { discriminatorValue } = options;

      if (discriminatorValue) {
        metadataArgsStorage.discriminatorValues.push({
          target: options.target || options.name,
          value: discriminatorValue,
        });
      }

      this.transformColumnsRecursive(options, metadataArgsStorage);
    });

    return metadataArgsStorage;
  }

  private transformColumnsRecursive(
    options: EntitySchemaOptions<unknown>,
    metadataArgsStorage: MetadataArgsStorage
  ): void {
    // add columns metadata args from the schema
    Object.keys(options.columns).forEach((columnName) => {
      const column =
        options.columns[columnName as keyof typeof options.columns]!;

      const regularColumn = column as EntitySchemaColumnOptions;
      let mode: ColumnMode = 'regular';
      if (regularColumn.createDate) mode = 'createDate';
      if (regularColumn.updateDate) mode = 'updateDate';
      if (regularColumn.deleteDate) mode = 'deleteDate';
      if (regularColumn.version) mode = 'version';
      if (regularColumn.treeChildrenCount) mode = 'treeChildrenCount';
      if (regularColumn.treeLevel) mode = 'treeLevel';
      if (regularColumn.objectId) mode = 'objectId';
      if (regularColumn.virtualProperty) mode = 'virtual-property';

      const columnArgs: ColumnMetadataArgs = {
        target: options.target || options.name,
        mode: mode,
        propertyName: columnName,
        options: {
          type: regularColumn.type,
          name: regularColumn.objectId ? '_id' : regularColumn.name,
          primaryKeyConstraintName: regularColumn.primaryKeyConstraintName,
          length: regularColumn.length,
          width: regularColumn.width,
          nullable: regularColumn.nullable,
          readonly: regularColumn.readonly,
          update: regularColumn.update,
          select: regularColumn.select,
          insert: regularColumn.insert,
          primary: regularColumn.primary,
          unique: regularColumn.unique,
          comment: regularColumn.comment,
          default: regularColumn.default,
          onUpdate: regularColumn.onUpdate,
          precision: regularColumn.precision,
          scale: regularColumn.scale,
          zerofill: regularColumn.zerofill,
          unsigned: regularColumn.unsigned,
          charset: regularColumn.charset,
          collation: regularColumn.collation,
          enum: regularColumn.enum,
          enumName: regularColumn.enumName,
          asExpression: regularColumn.asExpression,
          generatedType: regularColumn.generatedType,
          hstoreType: regularColumn.hstoreType,
          array: regularColumn.array,
          transformer: regularColumn.transformer,
          spatialFeatureType: regularColumn.spatialFeatureType,
          srid: regularColumn.srid,
          query: regularColumn.query,
        },
      };
      metadataArgsStorage.columns.push(columnArgs);

      if (regularColumn.generated) {
        const generationArgs: GeneratedMetadataArgs = {
          target: options.target || options.name,
          propertyName: columnName,
          strategy:
            typeof regularColumn.generated === 'string'
              ? regularColumn.generated
              : 'increment',
        };
        metadataArgsStorage.generations.push(generationArgs);
      }

      if (regularColumn.unique)
        metadataArgsStorage.uniques.push({
          target: options.target || options.name,
          columns: [columnName],
        });

      if (regularColumn.foreignKey) {
        const foreignKey = regularColumn.foreignKey;

        const foreignKeyArgs: ForeignKeyMetadataArgs = {
          target: options.target || options.name,
          type: foreignKey.target,
          propertyName: columnName,
          inverseSide: foreignKey.inverseSide,
          name: foreignKey.name,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
          deferrable: foreignKey.deferrable,
        };
        metadataArgsStorage.foreignKeys.push(foreignKeyArgs);
      }
    });

    // add relation metadata args from the schema
    if (options.relations) {
      Object.keys(options.relations).forEach((relationName) => {
        const relationSchema = options.relations![
          relationName as keyof typeof options.relations
        ]! as EntitySchemaRelationOptions;
        const relation: RelationMetadataArgs = {
          target: options.target || options.name,
          propertyName: relationName,
          relationType: relationSchema.type,
          isLazy: relationSchema.lazy || false,
          type: relationSchema.target,
          inverseSideProperty: relationSchema.inverseSide,
          isTreeParent: relationSchema.treeParent,
          isTreeChildren: relationSchema.treeChildren,
          options: {
            eager: relationSchema.eager || false,
            cascade: relationSchema.cascade,
            nullable: relationSchema.nullable,
            onDelete: relationSchema.onDelete,
            onUpdate: relationSchema.onUpdate,
            deferrable: relationSchema.deferrable,
            // primary: relationSchema.primary,
            createForeignKeyConstraints:
              relationSchema.createForeignKeyConstraints,
            persistence: relationSchema.persistence,
            orphanedRowAction: relationSchema.orphanedRowAction,
          },
        };

        metadataArgsStorage.relations.push(relation);

        // add join column
        if (relationSchema.joinColumn) {
          if (typeof relationSchema.joinColumn === 'boolean') {
            const joinColumn: JoinColumnMetadataArgs = {
              target: options.target || options.name,
              propertyName: relationName,
            };
            metadataArgsStorage.joinColumns.push(joinColumn);
          } else {
            const joinColumnsOptions = Array.isArray(relationSchema.joinColumn)
              ? relationSchema.joinColumn
              : [relationSchema.joinColumn];

            for (const joinColumnOption of joinColumnsOptions) {
              const joinColumn: JoinColumnMetadataArgs = {
                target: options.target || options.name,
                propertyName: relationName,
                name: joinColumnOption.name,
                referencedColumnName: joinColumnOption.referencedColumn,
                foreignKeyConstraintName:
                  joinColumnOption.foreignKeyConstraintName,
              };
              metadataArgsStorage.joinColumns.push(joinColumn);
            }
          }
        }

        // add join table
        if (relationSchema.joinTable) {
          if (typeof relationSchema.joinTable === 'boolean') {
            const joinTable: JoinTableMetadataArgs = {
              target: options.target || options.name,
              propertyName: relationName,
            };
            metadataArgsStorage.joinTables.push(joinTable);
          } else {
            const joinTable: JoinTableMetadataArgs = {
              target: options.target || options.name,
              propertyName: relationName,
              name: relationSchema.joinTable.name,
              database: relationSchema.joinTable.database,
              schema: relationSchema.joinTable.schema,
              joinColumns: ((relationSchema.joinTable as JoinTableOptions)
                .joinColumn
                ? [(relationSchema.joinTable as JoinTableOptions).joinColumn!]
                : (relationSchema.joinTable as JoinTableMultipleColumnsOptions)
                    .joinColumns) as Array<JoinColumnMetadataArgs>,
              inverseJoinColumns: ((
                relationSchema.joinTable as JoinTableOptions
              ).inverseJoinColumn
                ? [
                    (relationSchema.joinTable as JoinTableOptions)
                      .inverseJoinColumn!,
                  ]
                : (relationSchema.joinTable as JoinTableMultipleColumnsOptions)
                    .inverseJoinColumns) as Array<JoinColumnMetadataArgs>,
            };
            metadataArgsStorage.joinTables.push(joinTable);
          }
        }
      });
    }

    // add relation id metadata args from the schema
    if (options.relationIds) {
      Object.keys(options.relationIds).forEach((relationIdName) => {
        const relationIdOptions = options.relationIds![
          relationIdName as keyof typeof options.relationIds
        ]! as EntitySchemaRelationIdOptions;
        const relationId: RelationIdMetadataArgs = {
          propertyName: relationIdName,
          relation: relationIdOptions.relationName,
          target: options.target || options.name,
          alias: relationIdOptions.alias,
          queryBuilderFactory: relationIdOptions.queryBuilderFactory,
        };
        metadataArgsStorage.relationIds.push(relationId);
      });
    }

    // add index metadata args from the schema
    if (options.indices) {
      options.indices.forEach((index) => {
        const indexArgs: IndexMetadataArgs = {
          target: options.target || options.name,
          name: index.name,
          unique: index.unique === true ? true : false,
          spatial: index.spatial === true ? true : false,
          fulltext: index.fulltext === true ? true : false,
          nullFiltered: index.nullFiltered === true ? true : false,
          parser: index.parser,
          synchronize: index.synchronize === false ? false : true,
          where: index.where,
          sparse: index.sparse,
          columns: index.columns,
        };
        metadataArgsStorage.indices.push(indexArgs);
      });
    }

    if (options.foreignKeys) {
      options.foreignKeys.forEach((foreignKey) => {
        const foreignKeyArgs: ForeignKeyMetadataArgs = {
          target: options.target || options.name,
          type: foreignKey.target,
          columnNames: foreignKey.columnNames,
          referencedColumnNames: foreignKey.referencedColumnNames,
          name: foreignKey.name,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
          deferrable: foreignKey.deferrable,
        };
        metadataArgsStorage.foreignKeys.push(foreignKeyArgs);
      });
    }

    // add unique metadata args from the schema
    if (options.uniques) {
      options.uniques.forEach((unique) => {
        const uniqueArgs: UniqueMetadataArgs = {
          target: options.target || options.name,
          name: unique.name,
          columns: unique.columns,
          deferrable: unique.deferrable,
        };
        metadataArgsStorage.uniques.push(uniqueArgs);
      });
    }

    // add check metadata args from the schema
    if (options.checks) {
      options.checks.forEach((check) => {
        const checkArgs: CheckMetadataArgs = {
          target: options.target || options.name,
          name: check.name,
          expression: check.expression,
        };
        metadataArgsStorage.checks.push(checkArgs);
      });
    }

    // add exclusion metadata args from the schema
    if (options.exclusions) {
      options.exclusions.forEach((exclusion) => {
        const exclusionArgs: ExclusionMetadataArgs = {
          target: options.target || options.name,
          name: exclusion.name,
          expression: exclusion.expression,
        };
        metadataArgsStorage.exclusions.push(exclusionArgs);
      });
    }

    if (options.embeddeds) {
      Object.keys(options.embeddeds).forEach((columnName) => {
        const embeddedOptions = options.embeddeds![
          columnName as keyof typeof options.embeddeds
        ] as EntitySchemaEmbeddedColumnOptions;

        if (!embeddedOptions.schema)
          throw EntitySchemaEmbeddedError.createEntitySchemaIsRequiredException(
            columnName
          );

        const embeddedSchema = embeddedOptions.schema.options;

        metadataArgsStorage.embeddeds.push({
          target: options.target || options.name,
          propertyName: columnName,
          isArray: embeddedOptions.array === true,
          prefix:
            embeddedOptions.prefix !== undefined
              ? embeddedOptions.prefix
              : undefined,
          type: () => embeddedSchema?.target || embeddedSchema.name,
        });

        this.transformColumnsRecursive(embeddedSchema, metadataArgsStorage);
      });
    }

    if (options.trees) {
      options.trees.forEach((tree) => {
        metadataArgsStorage.trees.push({
          target: options.target || options.name,
          type: tree.type,
          options: tree.options,
        });
      });
    }
  }
}
