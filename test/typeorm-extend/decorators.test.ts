import { beforeEach, describe, expect, it } from 'vitest';

import { OrmStrategy } from '../../src/case-strategy/orm-strategy.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { Column } from '../../src/typeorm/decorator/columns/Column.js';
import { PrimaryColumn } from '../../src/typeorm/decorator/columns/PrimaryColumn.js';
import { Entity } from '../../src/typeorm/decorator/entity/Entity.js';
import { getMetadataArgsStorage } from '../../src/typeorm/globals.js';
import type { ObjectLiteral } from '../../src/typeorm/index.js';
import { ExtendColumn } from '../../src/typeorm-extend/decorators/ExtendColumn.js';
import { ExtendEntity } from '../../src/typeorm-extend/decorators/ExtendEntity.js';
import { ExtendPrimaryColumn } from '../../src/typeorm-extend/decorators/ExtendPrimaryColumn.js';
import { ExtendPrimaryGeneratedColumn } from '../../src/typeorm-extend/decorators/ExtendPrimaryGeneratedColumn.js';
import type { TFunction } from '../../src/types/utility.types.js';
import { DatabaseNamingCache } from '../../src/utils/database-naming-cache.js';
import { ServerError } from '../../src/utils/server-error.js';

class BaseEntity {
  public id!: number;
}

class ExtendedEntity extends BaseEntity {}

function resetStorage(): void {
  const storage = getMetadataArgsStorage();
  storage.tables.length = 0;
  storage.columns.length = 0;
  storage.generations.length = 0;
  storage.uniques.length = 0;
}

async function buildMetadata(dataSource: DataSource): Promise<void> {
  await (
    dataSource as unknown as {
      buildMetadatas(): Promise<void>;
    }
  ).buildMetadatas();
}

describe('typeorm-extend decorators', (): void => {
  beforeEach((): void => {
    resetStorage();
  });

  it('extends entity metadata and preserves the original copy', (): void => {
    const storage = getMetadataArgsStorage();
    storage.tables.push({
      target: BaseEntity as unknown as TFunction,
      type: 'regular',
      name: 'base_entity',
      schema: 'public',
    });

    ExtendEntity({ schema: 'oracle' })(ExtendedEntity);

    expect(storage.tables).toHaveLength(2);
    expect(storage.tables[0]).toMatchObject({
      target: ExtendedEntity,
      schema: 'oracle',
    });
    expect(storage.tables[1]).toMatchObject({
      target: BaseEntity as unknown as TFunction,
      schema: 'public',
    });
  });

  it('extends column metadata, generation metadata, and unique metadata', (): void => {
    const storage = getMetadataArgsStorage();
    storage.columns.push({
      target: BaseEntity as unknown as TFunction,
      propertyName: 'id',
      mode: 'regular',
      options: {
        type: 'number',
        unique: true,
        generated: 'increment',
      },
    } as never);
    storage.generations.push({
      target: BaseEntity as unknown as TFunction,
      propertyName: 'id',
      strategy: 'increment',
    });
    storage.uniques.push({
      target: BaseEntity as unknown as TFunction,
      columns: ['id'],
      name: 'uq_base_id',
    });

    ExtendColumn({ type: 'varchar', unique: false, generated: false } as never)(
      ExtendedEntity.prototype,
      'id'
    );

    expect(storage.columns).toHaveLength(2);
    expect(storage.columns[0]).toMatchObject({
      target: ExtendedEntity,
      propertyName: 'id',
      options: { type: 'varchar', unique: false, generated: false },
    });
    expect(storage.columns[1]).toMatchObject({ target: BaseEntity });
    expect(storage.generations).toHaveLength(1);
    expect(storage.uniques).toHaveLength(1);
  });

  it('extends primary column metadata', (): void => {
    const storage = getMetadataArgsStorage();
    storage.columns.push({
      target: BaseEntity,
      propertyName: 'id',
      mode: 'regular',
      options: { primary: true, type: 'number' },
    } as never);

    ExtendPrimaryColumn({ type: 'varchar' } as never)(
      ExtendedEntity.prototype,
      'id'
    );

    expect(storage.columns[0]).toMatchObject({
      target: ExtendedEntity,
      options: { primary: true, type: 'varchar' },
    });
  });

  it('preserves inherited database column names for extended entity queries', async (): Promise<void> => {
    class Research implements ObjectLiteral {
      [key: string]: unknown;

      public id!: number;
      public patientId!: number;
    }

    class ResearchOracle extends Research {}

    Entity({
      name: 'RESEARCH',
      schema: 'SOLUTION_DIAGNOSTIC',
      synchronize: false,
    })(Research);
    PrimaryColumn({ name: 'ID', type: Number, nullable: false })(
      Research.prototype,
      'id'
    );
    Column({ name: 'PATIENT_ID', type: Number, nullable: false })(
      Research.prototype,
      'patientId'
    );

    ExtendPrimaryColumn({ type: 'number' } as never)(
      ResearchOracle.prototype,
      'id'
    );
    ExtendColumn({ type: 'number' } as never)(
      ResearchOracle.prototype,
      'patientId'
    );
    ExtendEntity()(ResearchOracle);

    const namingStrategy = new OrmStrategy(
      Symbol('columns'),
      (value: string): string => value.toUpperCase(),
      new DatabaseNamingCache<string>()
    );
    expect(namingStrategy.columnName('patientId', undefined as never, [])).toBe(
      'PATIENTID'
    );

    const dataSource = new DataSource({
      type: 'oracle',
      entities: [ResearchOracle as unknown as TFunction],
      namingStrategy,
    });
    await buildMetadata(dataSource);

    const metadata = dataSource.getMetadata(ResearchOracle);
    const patientColumn = metadata.findColumnWithPropertyName('patientId');
    expect(patientColumn?.givenDatabaseName).toBe('PATIENT_ID');
    expect(patientColumn?.databaseName).toBe('PATIENT_ID');

    const query = dataSource
      .createQueryBuilder(ResearchOracle, metadata.name)
      .setFindOptions({
        where: {
          patientId: 284001509556,
          id: 32664304,
        },
      })
      .select('COUNT(1)', 'cnt')
      .getQuery();

    expect(query).toContain('"ResearchOracle".PATIENT_ID =');
    expect(query).not.toContain('PATIENTID');
  });

  it('extends primary generated column metadata with descriptor options', (): void => {
    const storage = getMetadataArgsStorage();
    storage.columns.push({
      target: BaseEntity,
      propertyName: 'id',
      mode: 'regular',
      options: { primary: true, type: 'number' },
    } as never);
    storage.generations.push({
      target: BaseEntity as unknown as TFunction,
      propertyName: 'id',
      strategy: 'increment',
    });

    ExtendPrimaryGeneratedColumn({
      strategy: 'uuid',
      options: { type: 'uuid' },
    } as never)(ExtendedEntity.prototype, 'id');

    expect(storage.columns[0]).toMatchObject({
      target: ExtendedEntity,
      options: { primary: true, type: 'uuid' },
    });
    expect(storage.generations[0]).toMatchObject({
      target: ExtendedEntity,
      strategy: 'uuid',
    });
  });

  it('throws when original metadata is missing', (): void => {
    expect((): void => {
      ExtendEntity()(ExtendedEntity);
    }).toThrow(ServerError);
    expect((): void => {
      ExtendColumn()(ExtendedEntity.prototype, 'id');
    }).toThrow(ServerError);
    expect((): void => {
      ExtendPrimaryGeneratedColumn()(ExtendedEntity.prototype, 'id');
    }).toThrow(ServerError);
  });
});
