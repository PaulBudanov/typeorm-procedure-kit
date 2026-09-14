import { describe, expect, expectTypeOf, it } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import { AbstractTypeormRepository } from '../../src/typeorm-extend/index.js';

import type {
  IBuildBaseQueryContext,
  IRepositoryContext,
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

class OwnerEntity {
  public id!: number;
  public metadata!: { label: string };
  public tags!: Array<string>;
  public posts!: Array<PostEntity>;
}

class PostEntity {
  public id!: number;
  public owner!: OwnerEntity;
}

class OwnerRepository extends AbstractTypeormRepository<OwnerEntity, string> {
  public exposeRepositoryContext(): IRepositoryContext<OwnerEntity> {
    return this.getRepositoryContext();
  }
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
    const relationPaths = repositoryContext.propertyPaths.additionalMessage;
    const relationProperty = repositoryContext.property.additionalMessage;

    expect(repositoryContext.propertyPaths.uuid4).toBe('uuid4');
    expect(repositoryContext.propertyPaths.isDeleted).toBe('isDeleted');
    expect(relationPaths.$path).toBe('additionalMessage');
    expect(relationPaths.uuid4).toBe('additionalMessage.uuid4');
    expect(relationPaths.isDeleted).toBe('additionalMessage.isDeleted');
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
    expect(relationProperty.uuid4).toBe('UUID4');
    expect(relationProperty.isDeleted).toBe('IS_DELETED');
    expect(baseQueryContext.propertyPaths).toStrictEqual(
      repositoryContext.propertyPaths
    );
    expect(baseQueryContext.property).toStrictEqual(repositoryContext.property);
    expectTypeOf(relationPaths.isDeleted).toEqualTypeOf<string>();
    expectTypeOf(relationProperty.isDeleted).toEqualTypeOf<string>();
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

    const query = builder
      .leftJoin(`${alias}.${propertyPaths.additionalMessage.$path}`, 'am')
      .orderBy(`am.${property.additionalMessage.isDeleted}`, 'DESC')
      .take(10)
      .getQuery();

    expect(query).toContain('ORDER BY "am".IS_DELETED DESC');
  });

  it('represents JSON and array columns as strings and cyclic relations as terminal or missing entries', async (): Promise<void> => {
    const owner = new EntitySchema<OwnerEntity>({
      name: 'Owner',
      columns: {
        id: { type: 'integer', primary: true },
        metadata: { type: 'jsonb' },
        tags: { type: 'text', array: true },
      },
      relations: {
        posts: { type: 'one-to-many', target: 'Post', inverseSide: 'owner' },
      },
    });
    const post = new EntitySchema<PostEntity>({
      name: 'Post',
      columns: { id: { type: 'integer', primary: true } },
      relations: {
        owner: {
          type: 'many-to-one',
          target: 'Owner',
          inverseSide: 'posts',
          joinColumn: true,
        },
      },
    });
    const dataSource = new TestDataSource({
      type: 'postgres',
      entities: [owner, post],
    });
    await buildMetadata(dataSource);
    const repository = new OwnerRepository(
      () => dataSource,
      () => 'Owner'
    );
    const { propertyPaths, property } = repository.exposeRepositoryContext();
    const expectedPaths = {
      id: 'id',
      metadata: 'metadata',
      tags: 'tags',
      posts: { $path: 'posts', id: 'posts.id', owner: 'posts.owner' },
    };
    const expectedProperty = {
      id: 'id',
      metadata: 'metadata',
      tags: 'tags',
      posts: { id: 'id' },
    };

    expect(propertyPaths).toEqual(expectedPaths);
    expect(property).toEqual(expectedProperty);
    expectTypeOf(propertyPaths.id).toEqualTypeOf<string>();
    expectTypeOf(propertyPaths.posts.$path).toEqualTypeOf<string>();
    expect(propertyPaths.posts.owner).toBe('posts.owner');
  });

  it('allows a self-referencing relation to end in a string or a missing map entry', async (): Promise<void> => {
    class NodeEntity {
      public id!: number;
      public parent!: NodeEntity | null;
    }

    class NodeRepository extends AbstractTypeormRepository<NodeEntity, string> {
      public exposeRepositoryContext(): IRepositoryContext<NodeEntity> {
        return this.getRepositoryContext();
      }
    }

    const entity = new EntitySchema<NodeEntity>({
      name: 'Node',
      columns: { id: { type: 'integer', primary: true } },
      relations: {
        parent: {
          type: 'many-to-one',
          target: 'Node',
          joinColumn: true,
          nullable: true,
        },
      },
    });
    const dataSource = new TestDataSource({
      type: 'postgres',
      entities: [entity],
    });
    await buildMetadata(dataSource);
    const repository = new NodeRepository(
      () => dataSource,
      () => 'Node'
    );
    const { propertyPaths, property } = repository.exposeRepositoryContext();
    const expectedPaths = {
      id: 'id',
      parent: { $path: 'parent', id: 'parent.id', parent: 'parent.parent' },
    };
    const expectedProperty = {
      id: 'id',
      parent: { id: 'id' },
    };

    expect(propertyPaths).toEqual(expectedPaths);
    expect(property).toEqual(expectedProperty);
  });
});
