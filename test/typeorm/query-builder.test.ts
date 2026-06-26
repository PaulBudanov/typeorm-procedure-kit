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

class AdditionalMessageEntity implements ObjectLiteral {
  [key: string]: unknown;

  public uuid4!: string;
  public isDeleted!: boolean;
}

class MessageEntity implements ObjectLiteral {
  [key: string]: unknown;

  public uuid4!: string;
  public isDeleted!: boolean;
  public additionalMessage!: AdditionalMessageEntity | null;
  public additionalMessagesUuid!: string;
}

class EmbeddedProfile {
  public firstName!: string;
}

class EmployeeEntity implements ObjectLiteral {
  [key: string]: unknown;

  public keyId!: number;
  public profile!: EmbeddedProfile;
}

async function buildMetadata(dataSource: DataSource): Promise<void> {
  await (
    dataSource as unknown as {
      buildMetadatas(): Promise<void>;
    }
  ).buildMetadatas();
}

function createMessageEntitySchemas(): Array<EntitySchema> {
  return [
    new EntitySchema<AdditionalMessageEntity>({
      target: AdditionalMessageEntity as unknown as TFunction,
      name: 'AdditionalMessageEntity',
      tableName: 'ADDITIONAL_MESSAGE',
      columns: {
        uuid4: {
          type: 'uuid',
          primary: true,
          name: 'UUID4',
        },
        isDeleted: {
          type: 'integer',
          name: 'IS_DELETED',
        },
      },
    }),
    new EntitySchema<MessageEntity>({
      target: MessageEntity as unknown as TFunction,
      name: 'MessageEntity',
      tableName: 'MESSAGE',
      columns: {
        uuid4: {
          type: 'uuid',
          primary: true,
          name: 'UUID4',
        },
        isDeleted: {
          type: 'integer',
          name: 'IS_DELETED',
        },
        additionalMessagesUuid: {
          type: 'uuid',
          name: 'ADDITIONAL_MESSAGES_UUID',
        },
      },
      relations: {
        additionalMessage: {
          type: 'many-to-one',
          target: 'AdditionalMessageEntity',
          joinColumn: {
            name: 'ADDITIONAL_MESSAGES_UUID',
            referencedColumn: 'uuid4',
          },
          nullable: true,
        },
      },
    }),
  ];
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

  it('selects and normalizes raw results through embedded database paths', async (): Promise<void> => {
    const profileSchema = new EntitySchema<EmbeddedProfile>({
      name: 'EmbeddedProfile',
      columns: {
        firstName: {
          type: 'text',
          name: 'FIRST_NAME',
        },
      },
    });
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [
        new EntitySchema<EmployeeEntity>({
          target: EmployeeEntity as unknown as TFunction,
          name: 'EmployeeEntity',
          tableName: 'EMPLOYEE',
          columns: {
            keyId: {
              type: 'integer',
              primary: true,
              name: 'KEYID',
            },
          },
          embeddeds: {
            profile: {
              schema: profileSchema,
              prefix: 'PROFILE_',
            },
          },
        }),
      ],
    });
    await buildMetadata(dataSource);

    const column = dataSource
      .getMetadata(EmployeeEntity)
      .findColumnWithPropertyPathStrict('profile.firstName')!;
    const builder = dataSource
      .createQueryBuilder(EmployeeEntity, 'e')
      .select([`e.${column.databasePath}`]);
    const query = builder.getQuery();

    expect(query).toContain(`"e".${column.databaseName}`);

    const normalizedRawResults = (
      builder as unknown as {
        normalizeRawResultsToEntityProperties(
          rawResults: Array<unknown>
        ): Array<ObjectLiteral>;
      }
    ).normalizeRawResultsToEntityProperties([
      {
        [`e_${column.databaseName}`]: 'Ada',
      },
    ]);

    expect(normalizedRawResults[0]).toEqual({
      'profile.firstName': 'Ada',
    });
  });

  it('orders joined aliases through database column names', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: createMessageEntitySchemas(),
    });
    await buildMetadata(dataSource);

    const query = dataSource
      .createQueryBuilder(MessageEntity, 'message')
      .leftJoin('message.additionalMessage', 'am')
      .orderBy('am.IS_DELETED', 'DESC')
      .getQuery();

    expect(query).toContain('ORDER BY "am".IS_DELETED DESC');
  });

  it('does not emit true as a count distinct column for joined fallback drivers', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'oracle',
      entities: createMessageEntitySchemas(),
    });
    await buildMetadata(dataSource);

    const builder = dataSource
      .createQueryBuilder(MessageEntity, 'message')
      .leftJoin('message.additionalMessage', 'am');
    const countExpression = (
      builder as unknown as {
        computeCountExpression(): string;
      }
    ).computeCountExpression();

    expect(countExpression).not.toContain('.true');
    expect(countExpression).toBe('COUNT(DISTINCT("message".UUID4))');
  });

  it('resolves returning and insert column lists through database column names', async (): Promise<void> => {
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
          },
        }),
      ],
    });
    await buildMetadata(dataSource);

    const insertQuery = dataSource
      .createQueryBuilder()
      .insert()
      .into(ManEntity, ['KEYID', 'LOCK_STATUS'])
      .values({ keyId: 1, lockStatus: 0 })
      .getQuery();
    const updateQuery = dataSource
      .createQueryBuilder()
      .update(ManEntity)
      .set({ status: 1 })
      .returning(['KEYID', 'LOCK_STATUS'])
      .where('KEYID = :id', { id: 1 })
      .getQuery();

    expect(insertQuery).toContain('(KEYID, LOCK_STATUS)');
    expect(updateQuery).toContain('RETURNING KEYID, LOCK_STATUS');
  });
});
