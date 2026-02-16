import { Table } from '../schema-builder/table/Table.js';
import { RandomGenerator } from '../util/RandomGenerator.js';
import { camelCase, snakeCase, titleCase } from '../util/StringUtils.js';

import { type NamingStrategyInterface } from './NamingStrategyInterface.js';

/**
 * Naming strategy that is used by default.
 */
export class DefaultNamingStrategy implements NamingStrategyInterface {
  protected getTableName(tableOrName: Table | string): string {
    if (typeof tableOrName !== 'string') {
      tableOrName = tableOrName.name;
    }

    return tableOrName.split('.').pop()!;
  }
  /**
   * Normalizes table name.
   *
   * @param targetName Name of the target entity that can be used to generate a table name.
   * @param userSpecifiedName For example if user specified a table name in a decorator, e.g. @Entity("name")
   */
  public tableName(
    targetName: string,
    userSpecifiedName: string | undefined
  ): string {
    return userSpecifiedName ? userSpecifiedName : snakeCase(targetName);
  }

  /**
   * Creates a table name for a junction table of a closure table.
   *
   * @param originalClosureTableName Name of the closure table which owns this junction table.
   */
  public closureJunctionTableName(originalClosureTableName: string): string {
    return originalClosureTableName + '_closure';
  }

  public columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: Array<string>
  ): string {
    const name = customName || propertyName;

    if (embeddedPrefixes.length)
      return camelCase(embeddedPrefixes.join('_')) + titleCase(name);

    return name;
  }

  public relationName(propertyName: string): string {
    return propertyName;
  }

  public primaryKeyName(
    tableOrName: Table | string,
    columnNames: Array<string>
  ): string {
    // sort incoming column names to avoid issue when ["id", "name"] and ["name", "id"] arrays
    const clonedColumnNames = [...columnNames];
    clonedColumnNames.sort();
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${clonedColumnNames.join('_')}`;
    return 'PK_' + RandomGenerator.sha1(key).substr(0, 27);
  }

  public uniqueConstraintName(
    tableOrName: Table | string,
    columnNames: Array<string>
  ): string {
    // sort incoming column names to avoid issue when ["id", "name"] and ["name", "id"] arrays
    const clonedColumnNames = [...columnNames];
    clonedColumnNames.sort();
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${clonedColumnNames.join('_')}`;
    return 'UQ_' + RandomGenerator.sha1(key).substr(0, 27);
  }

  public relationConstraintName(
    tableOrName: Table | string,
    columnNames: Array<string>,
    where?: string
  ): string {
    // sort incoming column names to avoid issue when ["id", "name"] and ["name", "id"] arrays
    const clonedColumnNames = [...columnNames];
    clonedColumnNames.sort();
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    let key = `${replacedTableName}_${clonedColumnNames.join('_')}`;
    if (where) key += `_${where}`;

    return 'REL_' + RandomGenerator.sha1(key).substr(0, 26);
  }

  public defaultConstraintName(
    tableOrName: Table | string,
    columnName: string
  ): string {
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${columnName}`;
    return 'DF_' + RandomGenerator.sha1(key).substr(0, 27);
  }

  public foreignKeyName(
    tableOrName: Table | string,
    columnNames: Array<string>,
    _referencedTablePath?: string,
    _referencedColumnNames?: Array<string>
  ): string {
    // sort incoming column names to avoid issue when ["id", "name"] and ["name", "id"] arrays
    const clonedColumnNames = [...columnNames];
    clonedColumnNames.sort();
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${clonedColumnNames.join('_')}`;
    return 'FK_' + RandomGenerator.sha1(key).substr(0, 27);
  }

  public indexName(
    tableOrName: Table | string,
    columnNames: Array<string>,
    where?: string
  ): string {
    // sort incoming column names to avoid issue when ["id", "name"] and ["name", "id"] arrays
    const clonedColumnNames = [...columnNames];
    clonedColumnNames.sort();
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    let key = `${replacedTableName}_${clonedColumnNames.join('_')}`;
    if (where) key += `_${where}`;

    return 'IDX_' + RandomGenerator.sha1(key).substr(0, 26);
  }

  public checkConstraintName(
    tableOrName: Table | string,
    expression: string,
    isEnum?: boolean
  ): string {
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${expression}`;
    const name = 'CHK_' + RandomGenerator.sha1(key).substr(0, 26);
    return isEnum ? `${name}_ENUM` : name;
  }

  public exclusionConstraintName(
    tableOrName: Table | string,
    expression: string
  ): string {
    const tableName = this.getTableName(tableOrName);
    const replacedTableName = tableName.replace('.', '_');
    const key = `${replacedTableName}_${expression}`;
    return 'XCL_' + RandomGenerator.sha1(key).substr(0, 26);
  }

  public joinColumnName(
    relationName: string,
    referencedColumnName: string
  ): string {
    return camelCase(relationName + '_' + referencedColumnName);
  }

  public joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
    _secondPropertyName: string
  ): string {
    return snakeCase(
      firstTableName +
        '_' +
        firstPropertyName.replace(/\./gi, '_') +
        '_' +
        secondTableName
    );
  }

  public joinTableColumnDuplicationPrefix(
    columnName: string,
    index: number
  ): string {
    return columnName + '_' + index;
  }

  public joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string
  ): string {
    return camelCase(
      tableName + '_' + (columnName ? columnName : propertyName)
    );
  }

  public joinTableInverseColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string
  ): string {
    return this.joinTableColumnName(tableName, propertyName, columnName);
  }

  /**
   * Adds globally set prefix to the table name.
   * This method is executed no matter if prefix was set or not.
   * Table name is either user's given table name, either name generated from entity target.
   * Note that table name comes here already normalized by #tableName method.
   */
  public prefixTableName(prefix: string, tableName: string): string {
    return prefix + tableName;
  }

  public nestedSetColumnNames = { left: 'nsleft', right: 'nsright' };
  public materializedPathColumnName = 'mpath';
}
