import { describe, expect, it } from 'vitest';

import { CaseStrategyFactory } from '../../src/case-strategy/case-strategy-factory.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import type { ObjectLiteral } from '../../src/typeorm/index.js';
import type { QueryExpressionMap } from '../../src/typeorm/query-builder/QueryExpressionMap.js';
import { RawSqlResultsToEntityTransformer } from '../../src/typeorm/query-builder/transformer/RawSqlResultsToEntityTransformer.js';
import type { TFunction } from '../../src/types/utility.types.js';

class ManEntity implements ObjectLiteral {
  [key: string]: unknown;

  public keyId!: number;
  public lockStatus!: number | null;
  public status!: number;
  public text!: string | null;
}

async function buildMetadata(dataSource: DataSource): Promise<void> {
  await (
    dataSource as unknown as {
      buildMetadatas(): Promise<void>;
    }
  ).buildMetadatas();
}

describe('QueryBuilder', (): void => {
  it('uses configured column name when replacing aliased property names', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [
        new EntitySchema<ManEntity>({
          target: ManEntity as unknown as TFunction,
          name: 'ManEntity',
          tableName: 'MAN',
          schema: 'SOLUTION_MED',
          columns: {
            keyId: {
              type: 'integer',
              primary: true,
              name: 'KEYID',
            },
            lockStatus: {
              type: 'integer',
              nullable: true,
              name: 'LOCK_STATUS',
            },
            status: {
              type: 'integer',
              name: 'STATUS',
            },
            text: {
              type: 'text',
              nullable: true,
              name: 'TEXT',
            },
          },
        }),
      ],
    });
    await buildMetadata(dataSource);

    const query = dataSource
      .createQueryBuilder(ManEntity, 'm')
      .select(['m.keyId', 'm.status'])
      .where('m.lockStatus = :isLocked', { isLocked: 0 })
      .andWhere('m.status = :isActive', { isActive: 1 })
      .getQuery();

    expect(query).toContain('"m".LOCK_STATUS = :isLocked');
    expect(query).not.toContain('"m".lockStatus');
  });

  it('hydrates entity fields selected through configured database column names', async (): Promise<void> => {
    const caseStrategy = CaseStrategyFactory.caseStrategyFactory();
    const dataSource = new DataSource({
      type: 'postgres',
      namingStrategy: caseStrategy.strategy,
      entities: [
        new EntitySchema<ManEntity>({
          target: ManEntity as unknown as TFunction,
          name: 'ManEntity',
          tableName: 'MAN',
          schema: 'SOLUTION_MED',
          columns: {
            keyId: {
              type: 'integer',
              primary: true,
              name: 'KEYID',
            },
            lockStatus: {
              type: 'integer',
              nullable: true,
              name: 'LOCK_STATUS',
            },
            status: {
              type: 'integer',
              name: 'STATUS',
            },
            text: {
              type: 'text',
              nullable: true,
              name: 'TEXT',
            },
          },
        }),
      ],
    });
    await buildMetadata(dataSource);

    const builder = dataSource
      .createQueryBuilder(ManEntity, 'm')
      .select(['m.KEYID', 'm.STATUS', 'm.TEXT']);
    const query = builder.getQuery();

    expect(query).toContain('"m".KEYID AS "m_KEYID"');
    expect(query).toContain('"m".STATUS AS "m_STATUS"');
    expect(query).toContain('"m".TEXT AS "m_TEXT"');

    const expressionMap = (
      builder as unknown as {
        expressionMap: QueryExpressionMap;
      }
    ).expressionMap;
    const transformer = new RawSqlResultsToEntityTransformer(
      expressionMap,
      dataSource.driver,
      [],
      [],
      undefined,
      caseStrategy.strategy.transformColumnName.bind(caseStrategy.strategy)
    );
    const entities = transformer.transform(
      [
        {
          mKeyid: 1,
          mStatus: 1,
          mText: 'Сотрудник Разработчика',
        },
      ],
      expressionMap.mainAlias!
    );

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      keyId: 1,
      status: 1,
      text: 'Сотрудник Разработчика',
    });

    const normalizedRawResults = (
      builder as unknown as {
        normalizeRawResultsToEntityProperties(
          rawResults: Array<unknown>
        ): Array<ObjectLiteral>;
      }
    ).normalizeRawResultsToEntityProperties([
      {
        mKeyid: 1,
        mStatus: 1,
        mText: 'Сотрудник Разработчика',
      },
    ]);

    expect(normalizedRawResults[0]).toEqual({
      keyId: 1,
      status: 1,
      text: 'Сотрудник Разработчика',
    });

    const customAliasBuilder = dataSource
      .createQueryBuilder(ManEntity, 'm')
      .select('m.keyId', 'm_KEYID');
    const customAliasRawResults = (
      customAliasBuilder as unknown as {
        normalizeRawResultsToEntityProperties(
          rawResults: Array<unknown>
        ): Array<ObjectLiteral>;
      }
    ).normalizeRawResultsToEntityProperties([{ mKeyid: 1 }]);

    expect(customAliasRawResults[0]).toEqual({ mKeyid: 1 });
  });

  it('uses the ORM strategy transform when replacing aliased database property names', async (): Promise<void> => {
    const caseStrategy = CaseStrategyFactory.caseStrategyFactory('snakeCase');
    const dataSource = new DataSource({
      type: 'postgres',
      namingStrategy: caseStrategy.strategy,
      entities: [
        new EntitySchema<ManEntity>({
          target: ManEntity as unknown as TFunction,
          name: 'ManEntity',
          tableName: 'MAN',
          schema: 'SOLUTION_MED',
          columns: {
            keyId: {
              type: 'integer',
              primary: true,
            },
            lockStatus: {
              type: 'integer',
              nullable: true,
            },
            status: {
              type: 'integer',
            },
          },
        }),
      ],
    });
    await buildMetadata(dataSource);

    const query = dataSource
      .createQueryBuilder(ManEntity, 'm')
      .select(['m.keyId'])
      .where('m.lock_status = :isLocked', { isLocked: 0 })
      .getQuery();

    expect(query).toContain('"m".lock_status = :isLocked');
    expect(query).not.toContain('"m".lockStatus');
  });
});
