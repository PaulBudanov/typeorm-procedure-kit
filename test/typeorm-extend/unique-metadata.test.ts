import { beforeEach, describe, expect, it } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { Column } from '../../src/typeorm/decorator/columns/Column.js';
import { PrimaryColumn } from '../../src/typeorm/decorator/columns/PrimaryColumn.js';
import { Entity } from '../../src/typeorm/decorator/entity/Entity.js';
import { Unique } from '../../src/typeorm/decorator/Unique.js';
import { getMetadataArgsStorage } from '../../src/typeorm/globals.js';
import { EntityMetadataBuilder } from '../../src/typeorm/metadata-builder/EntityMetadataBuilder.js';
import { ExtendColumn } from '../../src/typeorm-extend/decorators/ExtendColumn.js';

class BaseEntity {}
class ChildEntity extends BaseEntity {}

describe('extended column unique constraints', (): void => {
  beforeEach((): void => {
    const storage = getMetadataArgsStorage();
    storage.tables.length = 0;
    storage.columns.length = 0;
    storage.generations.length = 0;
    storage.uniques.length = 0;

    Entity('unique_base')(BaseEntity);
    Entity('unique_child')(ChildEntity);
    PrimaryColumn({ type: 'integer' })(BaseEntity.prototype, 'id');
    Column({ type: 'varchar' })(BaseEntity.prototype, 'email');
    Column({ type: 'integer' })(BaseEntity.prototype, 'tenantId');
  });

  it.each([undefined, false, true])(
    'preserves composite and functional constraints for unique=%s',
    (isUnique): void => {
      const storage = getMetadataArgsStorage();
      Unique('uq_email_tenant', ['email', 'tenantId'], {
        deferrable: 'INITIALLY DEFERRED',
      })(BaseEntity);
      Unique('uq_tenant_function', (entity) => [entity.tenantId])(BaseEntity);
      const originalConstraints = [...storage.uniques];
      const originalValues = storage.uniques.map((unique) => ({ ...unique }));

      ExtendColumn({ length: 255, unique: isUnique }, true)(
        ChildEntity.prototype,
        'email'
      );

      expect(storage.uniques.slice(0, 2)).toEqual(originalValues);
      expect(storage.uniques[0]).toBe(originalConstraints[0]);
      expect(storage.uniques[1]).toBe(originalConstraints[1]);
      const metadatas = new EntityMetadataBuilder(
        new DataSource({ type: 'postgres' }),
        storage
      ).build();
      for (const metadata of metadatas) {
        expect(
          metadata.uniques.map((unique) =>
            unique.columns.map((column) => column.propertyName)
          )
        ).toEqual(
          isUnique === true
            ? [['email', 'tenantId'], ['tenantId'], ['email']]
            : [['email', 'tenantId'], ['tenantId']]
        );
      }
    }
  );

  it('does not copy inherited uniqueness when only column options change', (): void => {
    const storage = getMetadataArgsStorage();
    Unique('uq_email', ['email'], { deferrable: 'INITIALLY DEFERRED' })(
      BaseEntity
    );
    const originalConstraints = [...storage.uniques];

    ExtendColumn({ length: 255 })(ChildEntity.prototype, 'email');

    expect(storage.uniques).toEqual(originalConstraints);
    expect(storage.uniques[0]?.target).toBe(BaseEntity);
    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    expect(metadatas).toHaveLength(2);
    for (const metadata of metadatas) {
      expect(metadata.uniques).toHaveLength(1);
      expect(metadata.uniques[0]).toMatchObject({
        name: 'uq_email',
        deferrable: 'INITIALLY DEFERRED',
      });
    }
  });

  it('does not duplicate a single-column constraint on the target or an ancestor', (): void => {
    const storage = getMetadataArgsStorage();
    Unique('uq_email', ['email'])(BaseEntity);

    ExtendColumn({ unique: true })(ChildEntity.prototype, 'email');
    ExtendColumn({ unique: true })(ChildEntity.prototype, 'email');
    ExtendColumn({ unique: true }, true)(BaseEntity.prototype, 'email');

    expect(storage.uniques).toHaveLength(1);
    expect(storage.uniques[0]?.target).toBe(BaseEntity);
    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    for (const metadata of metadatas) expect(metadata.uniques).toHaveLength(1);
  });

  it('retains inherited column-level uniqueness when unique is not overridden', (): void => {
    const storage = getMetadataArgsStorage();
    Column({ type: 'varchar', unique: true })(
      BaseEntity.prototype,
      'externalId'
    );
    const originalConstraints = [...storage.uniques];

    ExtendColumn({ length: 255 })(ChildEntity.prototype, 'externalId');

    expect(storage.uniques).toEqual(originalConstraints);
    expect(storage.uniques[0]?.target).toBe(BaseEntity);
    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    for (const metadata of metadatas) expect(metadata.uniques).toHaveLength(1);
  });

  it('adds a constraint only to the child when no single-column constraint exists', (): void => {
    const storage = getMetadataArgsStorage();
    Unique('uq_email_tenant', ['email', 'tenantId'])(BaseEntity);

    ExtendColumn({ unique: true })(ChildEntity.prototype, 'email');
    ExtendColumn({ unique: true })(ChildEntity.prototype, 'email');

    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    expect(
      metadatas.find((metadata) => metadata.targetName === BaseEntity.name)
        ?.uniques
    ).toHaveLength(1);
    expect(
      metadatas.find((metadata) => metadata.targetName === ChildEntity.name)
        ?.uniques
    ).toHaveLength(2);
  });

  it('removes an own single-column constraint without touching composite constraints or the base', (): void => {
    const storage = getMetadataArgsStorage();
    Unique('uq_email_tenant', ['email', 'tenantId'])(BaseEntity);
    Column({ type: 'varchar', unique: true })(ChildEntity.prototype, 'email');

    ExtendColumn({ unique: false })(ChildEntity.prototype, 'email');

    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    for (const metadata of metadatas) {
      expect(metadata.uniques.map((unique) => unique.name)).toEqual([
        'uq_email_tenant',
      ]);
    }
  });

  it('allows removal on the owning parent when explicitly selected', (): void => {
    const storage = getMetadataArgsStorage();
    Unique('uq_email', ['email'])(BaseEntity);

    ExtendColumn({ unique: false }, true)(ChildEntity.prototype, 'email');

    const metadatas = new EntityMetadataBuilder(
      new DataSource({ type: 'postgres' }),
      storage
    ).build();
    for (const metadata of metadatas) expect(metadata.uniques).toEqual([]);
  });

  it('rejects inherited removal before changing column, generation or unique metadata', (): void => {
    const storage = getMetadataArgsStorage();
    Column({ type: 'integer', unique: true, generated: 'increment' })(
      BaseEntity.prototype,
      'generatedId'
    );
    const columns = storage.columns.map((column) => ({
      ...column,
      options: { ...column.options },
    }));
    const generations = storage.generations.map((generation) => ({
      ...generation,
    }));
    const uniques = storage.uniques.map((unique) => ({ ...unique }));

    expect(() =>
      ExtendColumn({ unique: false, generated: false, name: 'CHANGED' })(
        ChildEntity.prototype,
        'generatedId'
      )
    ).toThrow(/inherited unique constraint/i);

    expect(storage.columns).toEqual(columns);
    expect(storage.generations).toEqual(generations);
    expect(storage.uniques).toEqual(uniques);
  });

  it.each([false, true])(
    'checks ancestors beyond an overridden column for parent target=%s',
    (isRegisterToParentTarget): void => {
      class GrandchildEntity extends ChildEntity {}
      const storage = getMetadataArgsStorage();
      Unique('uq_email', ['email'])(BaseEntity);
      Column({ type: 'varchar', unique: true })(ChildEntity.prototype, 'email');
      const columns = storage.columns.map((column) => ({
        ...column,
        options: { ...column.options },
      }));
      const uniques = storage.uniques.map((unique) => ({ ...unique }));

      expect(() =>
        ExtendColumn({ unique: false, length: 255 }, isRegisterToParentTarget)(
          GrandchildEntity.prototype,
          'email'
        )
      ).toThrow(/inherited unique constraint/i);

      expect(storage.columns).toEqual(columns);
      expect(storage.uniques).toEqual(uniques);
    }
  );
});
