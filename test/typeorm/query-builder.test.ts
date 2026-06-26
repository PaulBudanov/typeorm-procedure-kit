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

class MessageAuditEntity implements ObjectLiteral {
  [key: string]: unknown;

  public id!: number;
  public messageUuid!: string;
  public createdAt!: Date;
}

class OrderEntity implements ObjectLiteral {
  [key: string]: unknown;

  public tenantId!: string;
  public orderNo!: number;
  public status!: string;
  public messageUuid!: string;
  public createdAt!: Date;
  public message!: MessageEntity | null;
}

class EmbeddedProfile {
  public firstName!: string;
}

class EmployeeEntity implements ObjectLiteral {
  [key: string]: unknown;

  public keyId!: number;
  public profile!: EmbeddedProfile;
}

class AuditLogEntity implements ObjectLiteral {
  [key: string]: unknown;

  public id!: number;
  public status!: string;
  public deletedAt!: Date | null;
  public updatedAt!: Date;
  public version!: number;
}

async function buildMetadata(dataSource: DataSource): Promise<void> {
  await (
    dataSource as unknown as {
      buildMetadatas(): Promise<void>;
    }
  ).buildMetadatas();
}

function computeCountExpression(builder: unknown): string {
  return (
    builder as {
      computeCountExpression(): string;
    }
  ).computeCountExpression();
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

function createOrderEntitySchemas(): Array<EntitySchema> {
  return [
    ...createMessageEntitySchemas(),
    new EntitySchema<MessageAuditEntity>({
      target: MessageAuditEntity as unknown as TFunction,
      name: 'MessageAuditEntity',
      tableName: 'MESSAGE_AUDIT',
      columns: {
        id: {
          type: 'integer',
          primary: true,
          name: 'ID',
        },
        messageUuid: {
          type: 'uuid',
          name: 'MESSAGE_UUID',
        },
        createdAt: {
          type: 'timestamp',
          name: 'CREATED_AT',
        },
      },
    }),
    new EntitySchema<OrderEntity>({
      target: OrderEntity as unknown as TFunction,
      name: 'OrderEntity',
      tableName: 'ORDER_HEADER',
      columns: {
        tenantId: {
          type: 'varchar',
          primary: true,
          name: 'TENANT_ID',
        },
        orderNo: {
          type: 'integer',
          primary: true,
          name: 'ORDER_NO',
        },
        status: {
          type: 'varchar',
          name: 'ORDER_STATUS',
        },
        messageUuid: {
          type: 'uuid',
          name: 'MESSAGE_UUID',
        },
        createdAt: {
          type: 'timestamp',
          name: 'CREATED_AT',
        },
      },
      relations: {
        message: {
          type: 'many-to-one',
          target: 'MessageEntity',
          joinColumn: {
            name: 'MESSAGE_UUID',
            referencedColumn: 'uuid4',
          },
          nullable: true,
        },
      },
    }),
  ];
}

function createAuditLogEntitySchema(): EntitySchema {
  return new EntitySchema<AuditLogEntity>({
    target: AuditLogEntity as unknown as TFunction,
    name: 'AuditLogEntity',
    tableName: 'AUDIT_LOG',
    columns: {
      id: {
        type: 'integer',
        primary: true,
        name: 'ID',
      },
      status: {
        type: 'varchar',
        name: 'STATUS',
      },
      deletedAt: {
        type: 'timestamp',
        name: 'DELETED_AT',
        deleteDate: true,
        nullable: true,
      },
      updatedAt: {
        type: 'timestamp',
        name: 'UPDATED_AT',
        updateDate: true,
      },
      version: {
        type: 'integer',
        name: 'ROW_VERSION',
        version: true,
      },
    },
  });
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
    const countExpression = computeCountExpression(builder);

    expect(countExpression).not.toContain('.true');
    expect(countExpression).toBe('COUNT(DISTINCT("message".UUID4))');
  });

  it('builds postgres count distinct with composite primary columns', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: createOrderEntitySchemas(),
    });
    await buildMetadata(dataSource);

    const builder = dataSource
      .createQueryBuilder(OrderEntity, 'ord')
      .innerJoin('ord.message', 'message');
    const countExpression = computeCountExpression(builder);

    expect(countExpression).toBe(
      'COUNT(DISTINCT("ord".TENANT_ID, "ord".ORDER_NO))'
    );
    expect(countExpression).not.toContain('"TENANT_ID"');
    expect(countExpression).not.toContain('"ORDER_NO"');
  });

  it('builds fallback count distinct with composite primary columns', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'oracle',
      entities: createOrderEntitySchemas(),
    });
    await buildMetadata(dataSource);

    const builder = dataSource
      .createQueryBuilder(OrderEntity, 'ord')
      .innerJoin('ord.message', 'message');
    const countExpression = computeCountExpression(builder);

    expect(countExpression).toBe(
      'COUNT(DISTINCT("ord".TENANT_ID || \'|;|\' || "ord".ORDER_NO))'
    );
    expect(countExpression).not.toContain('"TENANT_ID"');
    expect(countExpression).not.toContain('"ORDER_NO"');
  });

  it('replaces database column names across a complex select query', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'oracle',
      entities: createOrderEntitySchemas(),
    });
    await buildMetadata(dataSource);

    const builder = dataSource
      .createQueryBuilder(OrderEntity, 'ord')
      .select('ord.TENANT_ID', 'tenant_alias')
      .addSelect('ord.ORDER_NO', 'order_alias')
      .addSelect('message.UUID4', 'message_uuid_alias')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(am.UUID4)')
          .from(AdditionalMessageEntity, 'am')
          .where('am.IS_DELETED = :subDeleted');
      }, 'active_message_count')
      .innerJoin('ord.message', 'message')
      .leftJoin('message.additionalMessage', 'am')
      .leftJoin(
        (subQuery) => {
          return subQuery
            .select('log.MESSAGE_UUID', 'log_message_uuid')
            .addSelect('MAX(log.CREATED_AT)', 'last_seen_at')
            .from(MessageAuditEntity, 'log')
            .groupBy('log.MESSAGE_UUID');
        },
        'message_log',
        'message_log.log_message_uuid = message.UUID4'
      )
      .where('ord.ORDER_STATUS = :status')
      .andWhere('message.IS_DELETED = :messageDeleted')
      .groupBy('ord.TENANT_ID')
      .addGroupBy('ord.ORDER_NO')
      .addGroupBy('message.UUID4')
      .having('COUNT(am.UUID4) > :minMessages')
      .orderBy('ord.CREATED_AT', 'DESC')
      .addOrderBy('message.UUID4', 'ASC')
      .offset(10)
      .limit(25);
    const query = builder.getQuery();
    const countExpression = computeCountExpression(builder);

    expect(query).toContain('"ord".TENANT_ID AS "tenant_alias"');
    expect(query).toContain('"ord".ORDER_NO AS "order_alias"');
    expect(query).toContain('"message".UUID4 AS "message_uuid_alias"');
    expect(query).toContain(
      '(SELECT COUNT("am".UUID4) FROM ADDITIONAL_MESSAGE "am" WHERE "am".IS_DELETED = :subDeleted) AS "active_message_count"'
    );
    expect(query).toContain('FROM ORDER_HEADER "ord"');
    expect(query).toContain(
      'INNER JOIN MESSAGE "message" ON "message".UUID4="ord".MESSAGE_UUID'
    );
    expect(query).toContain(
      'LEFT JOIN ADDITIONAL_MESSAGE "am" ON "am".UUID4="message".ADDITIONAL_MESSAGES_UUID'
    );
    expect(query).toContain(
      '(SELECT "log".MESSAGE_UUID AS "log_message_uuid", MAX("log".CREATED_AT) AS "last_seen_at" FROM MESSAGE_AUDIT "log" GROUP BY "log".MESSAGE_UUID) "message_log" ON message_log.log_message_uuid = "message".UUID4'
    );
    expect(query).toContain('WHERE "ord".ORDER_STATUS = :status');
    expect(query).toContain('AND "message".IS_DELETED = :messageDeleted');
    expect(query).toContain(
      'GROUP BY "ord".TENANT_ID, "ord".ORDER_NO, "message".UUID4'
    );
    expect(query).toContain('HAVING COUNT("am".UUID4) > :minMessages');
    expect(query).toContain(
      'ORDER BY "ord".CREATED_AT DESC, "message".UUID4 ASC'
    );
    expect(query).toContain('OFFSET 10 ROWS FETCH NEXT 25 ROWS ONLY');
    expect(query).not.toContain('"ord"."TENANT_ID"');
    expect(query).not.toContain('"message"."UUID4"');
    expect(countExpression).toBe(
      'COUNT(DISTINCT("ord".TENANT_ID || \'|;|\' || "ord".ORDER_NO))'
    );
    expect(countExpression).not.toContain('tenant_alias');
    expect(countExpression).not.toContain('order_alias');
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

  it('uses database column names across insert, update, delete, and soft-delete queries', async (): Promise<void> => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [createAuditLogEntitySchema()],
    });
    await buildMetadata(dataSource);

    const insertQuery = dataSource
      .createQueryBuilder()
      .insert()
      .into(AuditLogEntity, ['ID', 'STATUS'])
      .values({ id: 1, status: 'ready' })
      .getQuery();
    const updateQuery = dataSource
      .createQueryBuilder()
      .update(AuditLogEntity)
      .set({ status: 'done' })
      .where('ID = :id')
      .returning(['STATUS', 'UPDATED_AT'])
      .getQuery();
    const deleteQuery = dataSource
      .createQueryBuilder()
      .delete()
      .from(AuditLogEntity)
      .where('STATUS = :status')
      .returning(['ID'])
      .getQuery();
    const softDeleteQuery = dataSource
      .createQueryBuilder()
      .softDelete()
      .from(AuditLogEntity)
      .where('STATUS = :status')
      .returning(['ID', 'DELETED_AT'])
      .getQuery();

    expect(insertQuery).toContain('INSERT INTO AUDIT_LOG(ID, STATUS)');
    expect(updateQuery).toContain('UPDATE AUDIT_LOG SET STATUS = :orm_param_0');
    expect(updateQuery).toContain('ROW_VERSION = ROW_VERSION + 1');
    expect(updateQuery).toContain('UPDATED_AT = CURRENT_TIMESTAMP');
    expect(updateQuery).toContain('WHERE ID = :id');
    expect(updateQuery).toContain('RETURNING STATUS, UPDATED_AT');
    expect(deleteQuery).toBe(
      'DELETE FROM AUDIT_LOG WHERE STATUS = :status RETURNING ID'
    );
    expect(softDeleteQuery).toContain(
      'UPDATE AUDIT_LOG SET DELETED_AT = CURRENT_TIMESTAMP'
    );
    expect(softDeleteQuery).toContain('ROW_VERSION = ROW_VERSION + 1');
    expect(softDeleteQuery).toContain('UPDATED_AT = CURRENT_TIMESTAMP');
    expect(softDeleteQuery).toContain('WHERE STATUS = :status');
    expect(softDeleteQuery).toContain('RETURNING ID, DELETED_AT');
  });
});
