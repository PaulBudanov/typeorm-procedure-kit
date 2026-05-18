import { describe, expect, it } from 'vitest';

import { ColumnMetadata } from '../../../src/typeorm/metadata/ColumnMetadata.js';
import { EntityMetadata } from '../../../src/typeorm/metadata/EntityMetadata.js';
import type { RelationMetadata } from '../../../src/typeorm/metadata/RelationMetadata.js';
import type { EntityPropertiesMap } from '../../../src/typeorm/metadata/types/EntityPropertiesMap.js';

const createColumn = (options: {
  propertyName: string;
  propertyPath: string;
  databaseName: string;
  databasePath: string;
  parentPropertyNames?: Array<string>;
  isVirtual?: boolean;
  relationMetadata?: RelationMetadata;
}): ColumnMetadata => {
  return {
    embeddedMetadata: options.parentPropertyNames
      ? { parentPropertyNames: options.parentPropertyNames }
      : undefined,
    propertyName: options.propertyName,
    propertyPath: options.propertyPath,
    databaseName: options.databaseName,
    databasePath: options.databasePath,
    isVirtual: options.isVirtual ?? false,
    relationMetadata: options.relationMetadata,
    createValueMap: function (
      this: ColumnMetadata,
      value: unknown,
      useDatabaseName = false
    ) {
      return ColumnMetadata.prototype.createValueMap.call(
        this,
        value,
        useDatabaseName
      );
    },
  } as ColumnMetadata;
};

const createRelation = (
  propertyPath: string,
  valueMap: Record<string, unknown>
): RelationMetadata => {
  return {
    propertyPath,
    createValueMap: () => valueMap,
  } as unknown as RelationMetadata;
};

describe('EntityMetadata property maps', (): void => {
  it('keeps propertiesMap propertyPath-based and creates a column-only databasePropertiesMap', (): void => {
    const metadata = Object.create(EntityMetadata.prototype) as EntityMetadata;

    metadata.columns = [
      createColumn({
        propertyName: 'userId',
        propertyPath: 'userId',
        databaseName: 'user_id',
        databasePath: 'user_id',
      }),
      createColumn({
        propertyName: 'firstName',
        propertyPath: 'profile.firstName',
        databaseName: 'profileFirstName',
        databasePath: 'profile.profileFirstName',
        parentPropertyNames: ['profile'],
      }),
      createColumn({
        propertyName: 'account',
        propertyPath: 'account.id',
        databaseName: 'account_id',
        databasePath: 'account_id',
        isVirtual: true,
        relationMetadata: createRelation('account', { account: 'account' }),
      }),
    ];
    metadata.relations = [createRelation('posts', { posts: 'posts' })];

    expect(metadata.createPropertiesMap()).toEqual({
      userId: 'userId',
      profile: {
        firstName: 'profile.firstName',
      },
      account: 'account.id',
      posts: 'posts',
    });
    expect(metadata.createDatabasePropertiesMap()).toEqual({
      userId: 'user_id',
      profile: {
        firstName: 'profile.profileFirstName',
      },
    });
  });

  it('types property maps from entity keys', (): void => {
    interface Profile {
      firstName: string;
    }

    interface Post {
      id: number;
    }

    interface User {
      userId: number;
      createdAt: Date;
      profile: Profile;
      posts: Array<Post>;
    }

    const assertString = <T extends string>(_value?: T): void => undefined;

    assertString<EntityPropertiesMap<User>['userId']>();
    assertString<EntityPropertiesMap<User>['createdAt']>();
    assertString<EntityPropertiesMap<User>['profile']['firstName']>();
    assertString<EntityPropertiesMap<User>['posts']['id']>();

    expect(true).toBe(true);
  });
});
