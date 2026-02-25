import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { DataSource } from '../data-source/DataSource.js';

import { DeleteQueryBuilder } from './DeleteQueryBuilder.js';
import { InsertQueryBuilder } from './InsertQueryBuilder.js';
import { QueryBuilder } from './QueryBuilder.js';
import { RelationQueryBuilder } from './RelationQueryBuilder.js';
import { SelectQueryBuilder } from './SelectQueryBuilder.js';
import { SoftDeleteQueryBuilder } from './SoftDeleteQueryBuilder.js';
import { UpdateQueryBuilder } from './UpdateQueryBuilder.js';

export function registerQueryBuilders(): void {
  QueryBuilder.registerQueryBuilderClass(
    'DeleteQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) =>
      new DeleteQueryBuilder<ObjectLiteral>(qb)
  );
  QueryBuilder.registerQueryBuilderClass(
    'InsertQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) => new InsertQueryBuilder(qb)
  );
  QueryBuilder.registerQueryBuilderClass(
    'RelationQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) =>
      new RelationQueryBuilder(qb)
  );
  QueryBuilder.registerQueryBuilderClass(
    'SelectQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) => new SelectQueryBuilder(qb)
  );
  QueryBuilder.registerQueryBuilderClass(
    'SoftDeleteQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) =>
      new SoftDeleteQueryBuilder(qb)
  );
  QueryBuilder.registerQueryBuilderClass(
    'UpdateQueryBuilder',
    (qb: DataSource | QueryBuilder<ObjectLiteral>) => new UpdateQueryBuilder(qb)
  );
}
