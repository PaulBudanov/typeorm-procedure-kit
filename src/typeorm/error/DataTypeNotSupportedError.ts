import type { TDbConfig } from '../../types/config.types.js';
import { type ColumnType } from '../driver/types/ColumnTypes.js';
import { ColumnMetadata } from '../metadata/ColumnMetadata.js';

import { TypeORMError } from './TypeORMError.js';

export class DataTypeNotSupportedError extends TypeORMError {
  public constructor(
    column: ColumnMetadata,
    dataType: ColumnType,
    database?: TDbConfig['type']
  ) {
    super();

    const type = typeof dataType === 'string' ? dataType : dataType.name;
    this.message = `Data type "${type}" in "${column.entityMetadata.targetName}.${column.propertyName}" is not supported by "${database}" database.`;
  }
}
