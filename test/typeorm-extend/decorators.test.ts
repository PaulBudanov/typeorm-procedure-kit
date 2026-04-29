import { beforeEach, describe, expect, it } from 'vitest';

import { getMetadataArgsStorage } from '../../src/typeorm/globals.js';
import { ExtendColumn } from '../../src/typeorm-extend/decorators/ExtendColumn.js';
import { ExtendEntity } from '../../src/typeorm-extend/decorators/ExtendEntity.js';
import { ExtendPrimaryColumn } from '../../src/typeorm-extend/decorators/ExtendPrimaryColumn.js';
import { ExtendPrimaryGeneratedColumn } from '../../src/typeorm-extend/decorators/ExtendPrimaryGeneratedColumn.js';
import type { TFunction } from '../../src/types/utility.types.js';
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
