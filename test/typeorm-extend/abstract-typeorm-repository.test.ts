import { describe, expect, it } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import {
  AbstractTypeormRepository,
  type IBuildBaseQueryContext,
  type IRepositoryContext,
} from '../../src/typeorm-extend/index.js';

class TestDataSource extends DataSource {
  public buildTestMetadatas(): Promise<void> {
    return this.buildMetadatas();
  }
}

class ManEntity {
  public keyId!: number;
  public lockStatus!: number | null;
}

class AdditionalMessageEntity {
  public uuid4!: string;
  public isDeleted!: boolean;
}

class MessageEntity {
  public uuid4!: string;
  public isDeleted!: boolean;
  public createDate!: Date;
  public additionalMessage!: AdditionalMessageEntity | null;
  public additionalMessagesUuid!: string;
}

class ManRepository extends AbstractTypeormRepository<ManEntity, string> {
  public exposeEntityTarget(): string {
    return this.getEntityTarget();
  }

  public exposeBaseQueryContext(
    alias: string
  ): IBuildBaseQueryContext<ManEntity> {
    return this.buildBaseQueryContext(alias);
  }
}

class MessageRepository extends AbstractTypeormRepository<
  MessageEntity,
  string
> {
  public exposeRepositoryContext(): IRepositoryContext<MessageEntity> {
    return this.getRepositoryContext();
  }

  public exposeBaseQueryContext(
    alias: string
  ): IBuildBaseQueryContext<MessageEntity> {
    return this.buildBaseQueryContext(alias);
  }
}

const assertString = <TValue extends string>(_value?: TValue): void =>
  undefined;

async function buildMetadata(dataSource: TestDataSource): Promise<void> {
  await dataSource.buildTestMetadatas();
}

async function createMessageDataSource(): Promise<TestDataSource> {
  const additionalMessageEntity = new EntitySchema<AdditionalMessageEntity>({
    name: 'AdditionalMessageEntity',
    tableName: 'ADDITIONAL_MESSAGE',
    columns: {
      uuid4: {
        type: 'uuid',
        primary: true,
        name: 'UUID4',
      },
      isDeleted: {
        type: 'boolean',
        name: 'IS_DELETED',
      },
    },
  });
  const messageEntity = new EntitySchema<MessageEntity>({
    name: 'MessageEntityPostgres',
    tableName: 'MESSAGE',
    columns: {
      uuid4: {
        type: 'uuid',
        primary: true,
        name: 'UUID4',
      },
      isDeleted: {
        type: 'boolean',
        name: 'IS_DELETED',
      },
      createDate: {
        type: 'timestamp',
        createDate: true,
        name: 'CREATE_DATE',
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
  });
  const dataSource = new TestDataSource({
    type: 'postgres',
    entities: [additionalMessageEntity, messageEntity],
  });
  await buildMetadata(dataSource);

  return dataSource;
}

describe('AbstractTypeormRepository', (): void => {
  it('selects database-specific entity target and exposes property path maps', async (): Promise<void> => {
    const postgresEntity = new EntitySchema<ManEntity>({
      name: 'ManEntityPostgres',
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
      },
    });
    const dataSource = new TestDataSource({
      type: 'postgres',
      entities: [postgresEntity],
    });
    await buildMetadata(dataSource);

    const repository = new ManRepository(
      () => dataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: 'ManEntityOracle',
        postgres: 'ManEntityPostgres',
      })
    );
    const context = repository.exposeBaseQueryContext('m');

    expect(repository.exposeEntityTarget()).toBe('ManEntityPostgres');
    expect(context.alias).toBe('m');
    expect(context.propertyPaths.lockStatus).toBe('lockStatus');
    expect(context.property.lockStatus).toBe('LOCK_STATUS');
    expect(context.repository.metadata.target).toBe('ManEntityPostgres');
    expect(context.builder.getQuery()).toContain('FROM SOLUTION_MED.MAN "m"');
  });

  it('builds relation-aware property paths and database column maps in repository contexts', async (): Promise<void> => {
    const dataSource = await createMessageDataSource();

    const repository = new MessageRepository(
      () => dataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: 'MessageEntityOracle',
        postgres: 'MessageEntityPostgres',
      })
    );

    const repositoryContext = repository.exposeRepositoryContext();
    const baseQueryContext = repository.exposeBaseQueryContext('message');

    expect(repositoryContext.propertyPaths.uuid4).toBe('uuid4');
    expect(repositoryContext.propertyPaths.isDeleted).toBe('isDeleted');
    expect(repositoryContext.propertyPaths.additionalMessage.$path).toBe(
      'additionalMessage'
    );
    expect(repositoryContext.propertyPaths.additionalMessage.uuid4).toBe(
      'additionalMessage.uuid4'
    );
    expect(repositoryContext.propertyPaths.additionalMessage.isDeleted).toBe(
      'additionalMessage.isDeleted'
    );
    expect(repositoryContext.propertyPaths.additionalMessagesUuid).toBe(
      'additionalMessagesUuid'
    );
    expect(repositoryContext.propertyPaths.createDate).toBe('createDate');
    expect(repositoryContext.property.uuid4).toBe('UUID4');
    expect(repositoryContext.property.isDeleted).toBe('IS_DELETED');
    expect(repositoryContext.property.createDate).toBe('CREATE_DATE');
    expect(repositoryContext.property.additionalMessagesUuid).toBe(
      'ADDITIONAL_MESSAGES_UUID'
    );
    expect(repositoryContext.property.additionalMessage.uuid4).toBe('UUID4');
    expect(repositoryContext.property.additionalMessage.isDeleted).toBe(
      'IS_DELETED'
    );
    expect(baseQueryContext.propertyPaths).toStrictEqual(
      repositoryContext.propertyPaths
    );
    expect(baseQueryContext.property).toStrictEqual(repositoryContext.property);
    assertString<
      IRepositoryContext<MessageEntity>['propertyPaths']['additionalMessage']['isDeleted']
    >();
    assertString<
      IRepositoryContext<MessageEntity>['property']['additionalMessage']['isDeleted']
    >();
  });

  it('builds query builder joins, order and take through property paths', async (): Promise<void> => {
    const dataSource = await createMessageDataSource();

    const repository = new MessageRepository(
      () => dataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: 'MessageEntityOracle',
        postgres: 'MessageEntityPostgres',
      })
    );
    const { alias, builder, property, propertyPaths } =
      repository.exposeBaseQueryContext('message');

    expect(() =>
      builder
        .leftJoin(`${alias}.${propertyPaths.additionalMessage.$path}`, 'am')
        .orderBy(`am.${property.additionalMessage.isDeleted}`, 'DESC')
        .take(10)
        .getQuery()
    ).not.toThrow();
  });
});
