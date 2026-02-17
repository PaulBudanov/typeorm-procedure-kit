import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { DataSource } from '../data-source/DataSource.js';
import type { Query } from '../driver/Query.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import type { EqualOperator } from '../find-options/EqualOperator.js';
import type { FindOperator } from '../find-options/FindOperator.js';
import type { ColumnMetadata } from '../metadata/ColumnMetadata.js';
import type { EntityMetadata } from '../metadata/EntityMetadata.js';
import type { Subject } from '../persistence/Subject.js';
import type { Brackets } from '../query-builder/Brackets.js';
import type { DeleteQueryBuilder } from '../query-builder/DeleteQueryBuilder.js';
import type { InsertQueryBuilder } from '../query-builder/InsertQueryBuilder.js';
import type { NotBrackets } from '../query-builder/NotBrackets.js';
import type { RelationQueryBuilder } from '../query-builder/RelationQueryBuilder.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import type { SoftDeleteQueryBuilder } from '../query-builder/SoftDeleteQueryBuilder.js';
import type { UpdateQueryBuilder } from '../query-builder/UpdateQueryBuilder.js';
import { BaseEntity } from '../repository/BaseEntity.js';
import type { RdbmsSchemaBuilder } from '../schema-builder/RdbmsSchemaBuilder.js';
import type { Table } from '../schema-builder/table/Table.js';
import type { TableCheck } from '../schema-builder/table/TableCheck.js';
import type { TableColumn } from '../schema-builder/table/TableColumn.js';
import type { TableExclusion } from '../schema-builder/table/TableExclusion.js';
import type { TableForeignKey } from '../schema-builder/table/TableForeignKey.js';
import type { TableIndex } from '../schema-builder/table/TableIndex.js';
import type { TableUnique } from '../schema-builder/table/TableUnique.js';
import type { View } from '../schema-builder/view/View.js';

export class InstanceChecker {
  public static isEntityMetadata(obj: unknown): obj is EntityMetadata {
    return this.check(obj, 'EntityMetadata');
  }
  public static isColumnMetadata(obj: unknown): obj is ColumnMetadata {
    return this.check(obj, 'ColumnMetadata');
  }
  public static isSelectQueryBuilder(
    obj: unknown
  ): obj is SelectQueryBuilder<ObjectLiteral> {
    return this.check(obj, 'SelectQueryBuilder');
  }
  public static isInsertQueryBuilder(
    obj: unknown
  ): obj is InsertQueryBuilder<unknown> {
    return this.check(obj, 'InsertQueryBuilder');
  }
  public static isDeleteQueryBuilder(
    obj: unknown
  ): obj is DeleteQueryBuilder<unknown> {
    return this.check(obj, 'DeleteQueryBuilder');
  }
  public static isUpdateQueryBuilder(
    obj: unknown
  ): obj is UpdateQueryBuilder<unknown> {
    return this.check(obj, 'UpdateQueryBuilder');
  }
  public static isSoftDeleteQueryBuilder(
    obj: unknown
  ): obj is SoftDeleteQueryBuilder<unknown> {
    return this.check(obj, 'SoftDeleteQueryBuilder');
  }
  public static isRelationQueryBuilder(
    obj: unknown
  ): obj is RelationQueryBuilder<unknown> {
    return this.check(obj, 'RelationQueryBuilder');
  }
  public static isBrackets(obj: unknown): obj is Brackets {
    return this.check(obj, 'Brackets') || this.check(obj, 'NotBrackets');
  }
  public static isNotBrackets(obj: unknown): obj is NotBrackets {
    return this.check(obj, 'NotBrackets');
  }
  public static isSubject(obj: unknown): obj is Subject {
    return this.check(obj, 'Subject');
  }
  public static isRdbmsSchemaBuilder(obj: unknown): obj is RdbmsSchemaBuilder {
    return this.check(obj, 'RdbmsSchemaBuilder');
  }

  public static isEntitySchema(obj: unknown): obj is EntitySchema {
    return this.check(obj, 'EntitySchema');
  }
  public static isBaseEntityConstructor(
    obj: unknown
  ): obj is typeof BaseEntity {
    return (
      typeof obj === 'function' &&
      typeof (obj as typeof BaseEntity).hasId === 'function' &&
      typeof (obj as typeof BaseEntity).save === 'function' &&
      typeof (obj as typeof BaseEntity).useDataSource === 'function'
    );
  }
  public static isFindOperator(obj: unknown): obj is FindOperator<unknown> {
    return this.check(obj, 'FindOperator') || this.check(obj, 'EqualOperator');
  }
  public static isEqualOperator(obj: unknown): obj is EqualOperator<unknown> {
    return this.check(obj, 'EqualOperator');
  }
  public static isQuery(obj: unknown): obj is Query {
    return this.check(obj, 'Query');
  }
  public static isTable(obj: unknown): obj is Table {
    return this.check(obj, 'Table');
  }
  public static isTableCheck(obj: unknown): obj is TableCheck {
    return this.check(obj, 'TableCheck');
  }
  public static isTableColumn(obj: unknown): obj is TableColumn {
    return this.check(obj, 'TableColumn');
  }
  public static isTableExclusion(obj: unknown): obj is TableExclusion {
    return this.check(obj, 'TableExclusion');
  }
  public static isTableForeignKey(obj: unknown): obj is TableForeignKey {
    return this.check(obj, 'TableForeignKey');
  }
  public static isTableIndex(obj: unknown): obj is TableIndex {
    return this.check(obj, 'TableIndex');
  }
  public static isTableUnique(obj: unknown): obj is TableUnique {
    return this.check(obj, 'TableUnique');
  }
  public static isView(obj: unknown): obj is View {
    return this.check(obj, 'View');
  }
  public static isDataSource(obj: unknown): obj is DataSource {
    return this.check(obj, 'DataSource');
  }

  private static check(obj: unknown, name: string): boolean {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      (obj as { '@instanceof': symbol })['@instanceof'] === Symbol.for(name)
    );
  }
}
