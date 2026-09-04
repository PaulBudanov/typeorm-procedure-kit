import { describe, expect, it, vi } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { ClosureSubjectExecutor } from '../../src/typeorm/persistence/tree/ClosureSubjectExecutor.js';
import { MaterializedPathSubjectExecutor } from '../../src/typeorm/persistence/tree/MaterializedPathSubjectExecutor.js';
import { NestedSetSubjectExecutor } from '../../src/typeorm/persistence/tree/NestedSetSubjectExecutor.js';
import { TreeRepository } from '../../src/typeorm/repository/TreeRepository.js';

import type { ObjectLiteral } from '../../src/typeorm/index.js';
import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

interface IFluentBuilder {
  delete(): IFluentBuilder;
  execute(): Promise<unknown>;
  from(...args: Array<unknown>): IFluentBuilder;
  insert(): IFluentBuilder;
  into(...args: Array<unknown>): IFluentBuilder;
  update(...args: Array<unknown>): IFluentBuilder;
  set(...args: Array<unknown>): IFluentBuilder;
  values(...args: Array<unknown>): IFluentBuilder;
  updateEntity(...args: Array<unknown>): IFluentBuilder;
  callListeners(...args: Array<unknown>): IFluentBuilder;
  where(...args: Array<unknown>): IFluentBuilder;
  andWhere(...args: Array<unknown>): IFluentBuilder;
  orWhere(...args: Array<unknown>): IFluentBuilder;
  setParameters(...args: Array<unknown>): IFluentBuilder;
}

interface IReferencedColumnStub {
  propertyName: string;
  databaseName: string;
  propertyPath: string;
  getEntityValue(entity: ObjectLiteral): unknown;
  getEntityValueMap(entity: ObjectLiteral): ObjectLiteral;
}

interface IRepositoryBuilder {
  innerJoin(
    table: unknown,
    alias: unknown,
    condition: string
  ): IRepositoryBuilder;
  where(condition: string, parameters?: ObjectLiteral): IRepositoryBuilder;
  setParameters(parameters: ObjectLiteral): IRepositoryBuilder;
}

function createFluentBuilder(
  hooks: Partial<
    Record<keyof IFluentBuilder, (...args: Array<unknown>) => void>
  > = {}
): IFluentBuilder {
  const builder = {} as IFluentBuilder;
  for (const method of [
    'delete',
    'from',
    'insert',
    'into',
    'update',
    'set',
    'values',
    'updateEntity',
    'callListeners',
    'where',
    'andWhere',
    'orWhere',
    'setParameters',
  ] as const) {
    builder[method] = (...args: Array<unknown>): IFluentBuilder => {
      hooks[method]?.(...args);
      return builder;
    };
  }
  builder.execute = (): Promise<unknown> => {
    hooks.execute?.();
    return Promise.resolve({});
  };
  return builder;
}

function referencedColumn(
  propertyName: string,
  databaseName: string
): IReferencedColumnStub {
  return {
    propertyName,
    databaseName,
    propertyPath: propertyName,
    getEntityValue: (entity: ObjectLiteral): unknown => entity[propertyName],
    getEntityValueMap: (entity: ObjectLiteral): ObjectLiteral => ({
      [propertyName]: entity[propertyName],
    }),
  };
}

describe('tree identifier and binding policy', (): void => {
  it('parameterizes correlated composite closure identifiers without tuple cross-matches', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'postgres' });
    const captured: {
      where?: string;
      orWhere?: string;
      parameters?: ObjectLiteral;
    } = {};
    const builder = createFluentBuilder({
      where: (sql, parameters): void => {
        captured.where = sql as string;
        captured.parameters = parameters as ObjectLiteral;
      },
      orWhere: (sql, parameters): void => {
        captured.orWhere = sql as string;
        captured.parameters = parameters as ObjectLiteral;
      },
    });
    const tenantColumn = referencedColumn('tenantId', 'TENANT_DB');
    const localColumn = referencedColumn('localId', 'LOCAL_DB');
    const closureTable = {
      tablePath: 'APP.TREE_CLOSURE',
      ancestorColumns: [
        { databaseName: 'ANCESTOR_TENANT', referencedColumn: tenantColumn },
        { databaseName: 'ANCESTOR_LOCAL', referencedColumn: localColumn },
      ],
      descendantColumns: [
        { databaseName: 'DESCENDANT_TENANT', referencedColumn: tenantColumn },
        { databaseName: 'DESCENDANT_LOCAL', referencedColumn: localColumn },
      ],
    };
    const queryRunner = {
      connection: dataSource,
      manager: { createQueryBuilder: (): IFluentBuilder => builder },
    } as unknown as QueryRunner;
    const executor = new ClosureSubjectExecutor(queryRunner);
    const malicious = `tenant' OR 1=1 --`;

    await executor.remove([
      {
        identifier: { tenantId: malicious, localId: 'first' },
        metadata: { closureJunctionTable: closureTable },
      },
      {
        identifier: { tenantId: 'tenant-2', localId: 'second' },
        metadata: { closureJunctionTable: closureTable },
      },
    ] as never);

    expect(captured.where).toBe(
      '((ANCESTOR_TENANT = :tree_ancestor_0_0 AND ANCESTOR_LOCAL = :tree_ancestor_0_1) OR (ANCESTOR_TENANT = :tree_ancestor_1_0 AND ANCESTOR_LOCAL = :tree_ancestor_1_1))'
    );
    expect(captured.orWhere).toBe(
      '((DESCENDANT_TENANT = :tree_descendant_0_0 AND DESCENDANT_LOCAL = :tree_descendant_0_1) OR (DESCENDANT_TENANT = :tree_descendant_1_0 AND DESCENDANT_LOCAL = :tree_descendant_1_1))'
    );
    expect(captured.where).not.toContain(malicious);
    expect(captured.where).not.toContain(' IN ');
    expect(captured.parameters).toMatchObject({
      tree_ancestor_0_0: malicious,
      tree_ancestor_0_1: 'first',
      tree_ancestor_1_0: 'tenant-2',
      tree_ancestor_1_1: 'second',
      tree_descendant_0_0: malicious,
      tree_descendant_0_1: 'first',
      tree_descendant_1_0: 'tenant-2',
      tree_descendant_1_1: 'second',
    });
  });

  it('accepts zero closure parent ids and reads entity ids through column metadata', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'postgres' });
    let deleteParameters: ObjectLiteral | undefined;
    const builder = createFluentBuilder({
      setParameters: (parameters): void => {
        deleteParameters = parameters as ObjectLiteral;
      },
    });
    const rawQuery = vi.fn().mockResolvedValue({ records: [] });
    const queryRunner = {
      connection: dataSource,
      manager: { createQueryBuilder: (): IFluentBuilder => builder },
      query: rawQuery,
    } as unknown as QueryRunner;
    const idColumn = referencedColumn('entityId', 'ENTITY_ID_DB');
    const closureTable = {
      tablePath: 'TREE_CLOSURE',
      ancestorColumns: [
        { databaseName: 'ANCESTOR_ID', referencedColumn: idColumn },
      ],
      descendantColumns: [
        { databaseName: 'DESCENDANT_ID', referencedColumn: idColumn },
      ],
      uniques: [],
    };
    const oldParent = { entityId: 9 };
    const newParent = { entityId: 0 };
    const databaseEntity = {
      entityId: `entity' OR 1=1 --`,
      ENTITY_ID_DB: 'wrong-database-key-value',
      parent: oldParent,
    };
    const subject = {
      entity: { entityId: databaseEntity.entityId, parent: newParent },
      databaseEntity,
      metadata: {
        name: 'TreeEntity',
        target: 'TreeEntity',
        primaryColumns: [idColumn],
        closureJunctionTable: closureTable,
        treeParentRelation: {
          getEntityValue: (entity: ObjectLiteral): unknown => entity.parent,
        },
        treeChildrenRelation: { getEntityValue: (): Array<never> => [] },
        getEntityIdMap: (entity: ObjectLiteral): ObjectLiteral => ({
          entityId: entity.entityId,
        }),
      },
    };

    const executor = new ClosureSubjectExecutor(queryRunner);
    await executor.update(subject as never);

    expect(deleteParameters).toMatchObject({
      value_ENTITY_ID_DB: databaseEntity.entityId,
    });
    expect(rawQuery).toHaveBeenCalledOnce();
    expect(rawQuery.mock.calls[0]?.[1]).toContain(0);

    await executor.insert({
      identifier: { entityId: 'inserted-child' },
      insertedValueSet: { entityId: 'inserted-child' },
      entity: { entityId: 'inserted-child', parent: newParent },
      metadata: {
        name: 'TreeEntity',
        primaryColumns: [idColumn],
        closureJunctionTable: closureTable,
        treeParentRelation: {
          getEntityValue: (entity: ObjectLiteral): unknown => entity.parent,
        },
      },
    } as never);

    expect(rawQuery).toHaveBeenCalledTimes(2);
    expect(rawQuery.mock.calls[1]?.[1]).toContain(0);
  });

  it.each(['disabled', 'enabled'] as const)(
    'applies %s physical quoting to nested-set raw SQL while keeping aliases quoted',
    async (identifierQuoting): Promise<void> => {
      const dataSource = new DataSource({
        type: 'postgres',
        identifierQuoting,
      });
      const query = vi.fn().mockResolvedValue({ records: [{ count: '0' }] });
      const queryRunner = {
        connection: dataSource,
        query,
      } as unknown as QueryRunner;
      const executor = new NestedSetSubjectExecutor(queryRunner);
      const callUniqueRoot = executor as unknown as {
        isUniqueRootEntity(subject: unknown, parent: unknown): Promise<boolean>;
      };

      await callUniqueRoot.isUniqueRootEntity(
        {
          metadata: {
            tablePath: 'APP.TREE_NODE',
            treeParentRelation: {
              joinColumns: [
                { databaseName: 'PARENT_ID', getEntityValue: (): null => null },
              ],
            },
          },
        },
        undefined
      );

      const expectedTable =
        identifierQuoting === 'enabled' ? '"APP"."TREE_NODE"' : 'APP.TREE_NODE';
      const expectedColumn =
        identifierQuoting === 'enabled' ? '"PARENT_ID"' : 'PARENT_ID';
      expect(query.mock.calls[0]?.[0]).toBe(
        `SELECT COUNT(1) AS "count" FROM ${expectedTable} WHERE ${expectedColumn} IS NULL`
      );
    }
  );

  it.each(['disabled', 'enabled'] as const)(
    'parameterizes malicious materialized paths and uses databaseName with %s quoting',
    async (identifierQuoting): Promise<void> => {
      const dataSource = new DataSource({
        type: 'postgres',
        identifierQuoting,
      });
      let updateSet: Record<string, () => string> | undefined;
      let whereSql = '';
      const parameters: ObjectLiteral = {};
      const builder = createFluentBuilder({
        set: (value): void => {
          updateSet = value as Record<string, () => string>;
        },
        where: (sql, values): void => {
          whereSql = sql as string;
          Object.assign(parameters, values);
        },
        setParameters: (values): void => {
          Object.assign(parameters, values);
        },
      });
      const queryRunner = {
        connection: dataSource,
        manager: { createQueryBuilder: (): IFluentBuilder => builder },
      } as unknown as QueryRunner;
      const executor = new MaterializedPathSubjectExecutor(queryRunner);
      const getEntityPath = vi
        .spyOn(
          executor as unknown as {
            getEntityPath(subject: unknown, id: unknown): Promise<string>;
          },
          'getEntityPath'
        )
        .mockResolvedValueOnce(`new'parent.`)
        .mockResolvedValueOnce(`old'parent.`);
      const idColumn = referencedColumn('entityId', 'ENTITY_ID_DB');
      const oldParent = { entityId: 'old-parent' };
      const newParent = { entityId: 'new-parent' };
      const databaseEntity = { entityId: `leaf'42`, parent: oldParent };
      const subject = {
        entity: { entityId: databaseEntity.entityId, parent: newParent },
        databaseEntity,
        metadata: {
          target: 'TreeEntity',
          materializedPathColumn: {
            propertyPath: 'materializedPath',
            databaseName: 'TREE_PATH_DB',
          },
          treeParentRelation: {
            getEntityValue: (entity: ObjectLiteral): unknown => entity.parent,
            joinColumns: [{ referencedColumn: idColumn }],
          },
        },
      };

      await executor.update(subject as never);

      expect(getEntityPath).toHaveBeenCalledTimes(2);
      const expectedColumn =
        identifierQuoting === 'enabled' ? '"TREE_PATH_DB"' : 'TREE_PATH_DB';
      expect(updateSet?.materializedPath?.()).toBe(
        `REPLACE(${expectedColumn}, :tree_old_path, :tree_new_path)`
      );
      expect(whereSql).toBe(`${expectedColumn} LIKE :tree_like_path`);
      expect(whereSql).not.toContain(`leaf'42`);
      expect(parameters).toEqual({
        tree_like_path: `old'parent.leaf'42.%`,
        tree_old_path: `old'parent.leaf'42.`,
        tree_new_path: `new'parent.leaf'42.`,
      });
    }
  );

  it.each(['disabled', 'enabled'] as const)(
    'uses quoted aliases and custom database column names in both closure repository directions with %s quoting',
    (identifierQuoting): void => {
      const dataSource = new DataSource({
        type: 'postgres',
        identifierQuoting,
      });
      const entityIdColumn = referencedColumn('entityId', 'ENTITY_ID_DB');
      const metadata = {
        target: 'TreeEntity',
        targetName: 'TreeEntity',
        treeType: 'closure-table',
        closureJunctionTable: {
          tableName: 'TREE_CLOSURE',
          descendantColumns: [
            {
              propertyPath: 'descendantProperty',
              databaseName: 'DESCENDANT_DB',
              referencedColumn: entityIdColumn,
            },
          ],
          ancestorColumns: [
            {
              propertyPath: 'ancestorProperty',
              databaseName: 'ANCESTOR_DB',
              referencedColumn: entityIdColumn,
            },
          ],
        },
      };
      vi.spyOn(dataSource, 'getMetadata').mockReturnValue(metadata as never);
      const repository = new TreeRepository('TreeEntity', dataSource.manager);
      const calls: Array<{ condition: string; parameters?: ObjectLiteral }> =
        [];
      const builder: IRepositoryBuilder = {
        innerJoin: (
          _table: unknown,
          _alias: unknown,
          condition: string
        ): IRepositoryBuilder => {
          calls.push({ condition });
          return builder;
        },
        where: (
          condition: string,
          parameters?: ObjectLiteral
        ): IRepositoryBuilder => {
          calls.push({ condition, parameters });
          return builder;
        },
        setParameters: (parameters: ObjectLiteral): IRepositoryBuilder => {
          calls[calls.length - 1]!.parameters = parameters;
          return builder;
        },
      };
      vi.spyOn(repository, 'createQueryBuilder').mockReturnValue(
        builder as never
      );
      const entity = { entityId: `id' OR 1=1 --` };

      repository.createDescendantsQueryBuilder(
        'entity alias',
        'closure alias',
        entity
      );
      repository.createAncestorsQueryBuilder(
        'entity alias',
        'closure alias',
        entity
      );

      const physical = (value: string): string =>
        identifierQuoting === 'enabled' ? `"${value}"` : value;
      expect(calls[0]?.condition).toBe(
        `"closure alias".${physical(
          'DESCENDANT_DB'
        )} = "entity alias".${physical('ENTITY_ID_DB')}`
      );
      expect(calls[1]?.condition).toBe(
        `"closure alias".${physical('ANCESTOR_DB')} = :entityId`
      );
      expect(calls[2]?.condition).toBe(
        `"closure alias".${physical(
          'ANCESTOR_DB'
        )} = "entity alias".${physical('ENTITY_ID_DB')}`
      );
      expect(calls[3]?.condition).toBe(
        `"closure alias".${physical('DESCENDANT_DB')} = :entityId`
      );
      expect(calls.map((call) => call.condition).join(' ')).not.toContain(
        'ancestorProperty'
      );
      expect(calls.map((call) => call.condition).join(' ')).not.toContain(
        entity.entityId
      );
      expect(calls[1]?.parameters).toEqual({ entityId: entity.entityId });
      expect(calls[3]?.parameters).toEqual({ entityId: entity.entityId });
    }
  );
});
