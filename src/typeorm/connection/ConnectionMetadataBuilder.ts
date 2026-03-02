import type { TFunction } from '../../types/utility.types.js';
import { getFromContainer } from '../container.js';
import { DataSource } from '../data-source/DataSource.js';
import { EntitySchema } from '../entity-schema/EntitySchema.js';
import { EntitySchemaTransformer } from '../entity-schema/EntitySchemaTransformer.js';
import { getMetadataArgsStorage } from '../globals.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { EntityMetadataBuilder } from '../metadata-builder/EntityMetadataBuilder.js';
import type { MigrationInterface } from '../migration/MigrationInterface.js';
import type { EntitySubscriberInterface } from '../subscriber/EntitySubscriberInterface.js';
import { importClassesFromDirectories } from '../util/DirectoryExportedClassesLoader.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { OrmUtils } from '../util/OrmUtils.js';

/**
 * Builds migration instances, subscriber instances and entity metadatas for the given classes.
 */
export class ConnectionMetadataBuilder {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(protected connection: DataSource) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Builds migration instances for the given classes or directories.
   */
  public async buildMigrations(
    migrations: Array<TFunction | string>
  ): Promise<Array<MigrationInterface>> {
    const [migrationClasses, migrationDirectories] =
      OrmUtils.splitClassesAndStrings(migrations);
    const allMigrationClasses = [
      ...migrationClasses,
      ...(await importClassesFromDirectories(
        this.connection.logger,
        migrationDirectories
      )),
    ];
    return allMigrationClasses.map((migrationClass) =>
      getFromContainer<MigrationInterface>(migrationClass)
    );
  }

  /**
   * Builds subscriber instances for the given classes or directories.
   */
  public async buildSubscribers(
    subscribers: Array<TFunction | string>
  ): Promise<Array<EntitySubscriberInterface<unknown>>> {
    const [subscriberClasses, subscriberDirectories] =
      OrmUtils.splitClassesAndStrings(subscribers || []);
    const allSubscriberClasses = [
      ...subscriberClasses,
      ...(await importClassesFromDirectories(
        this.connection.logger,
        subscriberDirectories
      )),
    ];
    return getMetadataArgsStorage()
      .filterSubscribers(allSubscriberClasses)
      .map((metadata) =>
        getFromContainer<EntitySubscriberInterface<unknown>>(metadata.target)
      );
  }

  /**
   * Builds entity metadatas for the given classes or directories.
   */
  public async buildEntityMetadatas(
    entities: Array<TFunction | EntitySchema<unknown> | string>
  ): Promise<Array<EntityMetadata>> {
    // todo: instead we need to merge multiple metadata args storages

    const [entityClassesOrSchemas, entityDirectories] =
      OrmUtils.splitClassesAndStrings(entities || []);
    const entityClasses: Array<TFunction> = entityClassesOrSchemas.filter(
      (entityClass): entityClass is TFunction =>
        !InstanceChecker.isEntitySchema(entityClass)
    ) as Array<TFunction>;
    const entitySchemas: Array<EntitySchema<unknown>> =
      entityClassesOrSchemas.filter(
        (entityClass): entityClass is EntitySchema<unknown> =>
          InstanceChecker.isEntitySchema(entityClass)
      );
    const allEntityClasses = [
      ...entityClasses,
      ...(await importClassesFromDirectories(
        this.connection.logger,
        entityDirectories
      )),
    ];
    allEntityClasses.forEach((entityClass) => {
      // if we have entity schemas loaded from directories
      if (InstanceChecker.isEntitySchema(entityClass)) {
        entitySchemas.push(entityClass);
      }
    });
    const decoratorEntityMetadatas = new EntityMetadataBuilder(
      this.connection,
      getMetadataArgsStorage()
    ).build(allEntityClasses);

    const metadataArgsStorageFromSchema =
      new EntitySchemaTransformer().transform(entitySchemas);
    const schemaEntityMetadatas = new EntityMetadataBuilder(
      this.connection,
      metadataArgsStorageFromSchema
    ).build();

    return [...decoratorEntityMetadatas, ...schemaEntityMetadatas];
  }
}
