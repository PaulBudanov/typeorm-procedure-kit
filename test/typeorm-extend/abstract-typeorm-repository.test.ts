import { describe, expect, it } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import type { ObjectLiteral } from '../../src/typeorm/index.js';
import {
  AbstractTypeormRepository,
  type IBuildBaseQueryContext,
} from '../../src/typeorm-extend/index.js';
import type { TFunction } from '../../src/types/utility.types.js';

class ManEntity implements ObjectLiteral {
  [key: string]: unknown;

  public keyId!: number;
  public lockStatus!: number | null;
}

class ManEntityOracle extends ManEntity {}

class ManEntityPostgres extends ManEntity {}

class ManRepository extends AbstractTypeormRepository<
  ManEntity,
  typeof ManEntityOracle | typeof ManEntityPostgres
> {
  public exposeEntityTarget():
    | typeof ManEntityOracle
    | typeof ManEntityPostgres {
    return this.getEntityTarget();
  }

  public exposeBaseQueryContext(
    alias: string
  ): IBuildBaseQueryContext<ManEntity> {
    return this.buildBaseQueryContext(alias);
  }
}

async function buildMetadata(dataSource: DataSource): Promise<void> {
  await (
    dataSource as unknown as {
      buildMetadatas(): Promise<void>;
    }
  ).buildMetadatas();
}

describe('AbstractTypeormRepository', (): void => {
  it('selects database-specific entity target and exposes database property names', async (): Promise<void> => {
    const postgresEntity = new EntitySchema<ManEntity>({
      target: ManEntityPostgres as unknown as TFunction,
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
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [postgresEntity],
    });
    await buildMetadata(dataSource);

    const repository = new ManRepository(
      () => dataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: ManEntityOracle,
        postgres: ManEntityPostgres,
      })
    );
    const context = repository.exposeBaseQueryContext('m');

    expect(repository.exposeEntityTarget()).toBe(ManEntityPostgres);
    expect(context.alias).toBe('m');
    expect(context.property.lockStatus).toBe('LOCK_STATUS');
    expect(context.repository.metadata.target).toBe(ManEntityPostgres);
    expect(context.builder.getQuery()).toContain('FROM SOLUTION_MED.MAN "m"');
  });
});
