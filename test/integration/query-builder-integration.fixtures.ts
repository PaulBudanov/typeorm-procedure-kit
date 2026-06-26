import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { CaseStrategyFactory } from '../../src/case-strategy/case-strategy-factory.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import type { DataSourceOptions } from '../../src/typeorm/data-source/DataSourceOptions.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import type { ObjectLiteral } from '../../src/typeorm/index.js';
import type { ILoggerModule } from '../../src/types/logger.types.js';
import type { TFunction } from '../../src/types/utility.types.js';

export const queryBuilderTables = {
  message: 'TPK_IT_QB_MESSAGE',
  order: 'TPK_IT_QB_ORDER',
  audit: 'TPK_IT_QB_AUDIT',
  auditLog: 'TPK_IT_QB_AUDIT_LOG',
} as const;

const queryBuilderLogger: ILoggerModule = {
  error: (): void => undefined,
  log: (): void => undefined,
  warn: (): void => undefined,
};

export class IntegrationMessageEntity implements ObjectLiteral {
  [key: string]: unknown;

  public uuid4!: string;
  public isDeleted!: number;
  public body!: string;
}

export class IntegrationOrderEntity implements ObjectLiteral {
  [key: string]: unknown;

  public tenantId!: string;
  public orderNo!: number;
  public status!: string;
  public messageUuid!: string;
  public createdAt!: Date;
  public message!: IntegrationMessageEntity | null;
}

export class IntegrationMessageAuditEntity implements ObjectLiteral {
  [key: string]: unknown;

  public id!: number;
  public messageUuid!: string;
  public createdAt!: Date;
}

export class IntegrationAuditLogEntity implements ObjectLiteral {
  [key: string]: unknown;

  public id!: number;
  public status!: string;
  public deletedAt!: Date | null;
  public updatedAt!: Date;
  public version!: number;
}

export function createQueryBuilderIntegrationSchemas(): Array<EntitySchema> {
  return [
    new EntitySchema<IntegrationMessageEntity>({
      target: IntegrationMessageEntity as unknown as TFunction,
      name: 'IntegrationMessageEntity',
      tableName: queryBuilderTables.message,
      columns: {
        uuid4: {
          type: 'varchar',
          primary: true,
          name: 'UUID4',
        },
        isDeleted: {
          type: 'integer',
          name: 'IS_DELETED',
        },
        body: {
          type: 'varchar',
          name: 'BODY',
        },
      },
    }),
    new EntitySchema<IntegrationOrderEntity>({
      target: IntegrationOrderEntity as unknown as TFunction,
      name: 'IntegrationOrderEntity',
      tableName: queryBuilderTables.order,
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
          type: 'varchar',
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
          target: 'IntegrationMessageEntity',
          joinColumn: {
            name: 'MESSAGE_UUID',
            referencedColumn: 'uuid4',
          },
          nullable: true,
        },
      },
    }),
    new EntitySchema<IntegrationMessageAuditEntity>({
      target: IntegrationMessageAuditEntity as unknown as TFunction,
      name: 'IntegrationMessageAuditEntity',
      tableName: queryBuilderTables.audit,
      columns: {
        id: {
          type: 'integer',
          primary: true,
          name: 'ID',
        },
        messageUuid: {
          type: 'varchar',
          name: 'MESSAGE_UUID',
        },
        createdAt: {
          type: 'timestamp',
          name: 'CREATED_AT',
        },
      },
    }),
    new EntitySchema<IntegrationAuditLogEntity>({
      target: IntegrationAuditLogEntity as unknown as TFunction,
      name: 'IntegrationAuditLogEntity',
      tableName: queryBuilderTables.auditLog,
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
    }),
  ];
}

export function createQueryBuilderIntegrationDataSource(
  options: DataSourceOptions
): DataSource {
  const { strategy } = CaseStrategyFactory.caseStrategyFactory('lowerCase');

  if (options.type === 'postgres') {
    new PostgreSerializer(queryBuilderLogger, {
      caseStrategy: strategy,
      isNeedRegisterDefaultSerializers: false,
    }).registerFetchHandlerHook();
  } else {
    new OracleSerializer(queryBuilderLogger, {
      caseStrategy: strategy,
      isNeedRegisterDefaultSerializers: false,
    }).registerFetchHandlerHook();
  }

  return new DataSource({
    ...options,
    entities: createQueryBuilderIntegrationSchemas(),
    isQuotingDisabled: true,
    namingStrategy: strategy,
    synchronize: false,
  } as DataSourceOptions);
}
