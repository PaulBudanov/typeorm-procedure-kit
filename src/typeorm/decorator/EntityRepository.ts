import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { getMetadataArgsStorage } from '../globals.js';
import type { EntityRepositoryMetadataArgs } from '../metadata-args/EntityRepositoryMetadataArgs.js';

/**
 * Used to declare a class as a custom repository.
 * Custom repository can manage some specific entity or just be generic.
 * Custom repository optionally can extend AbstractRepository, Repository or TreeRepository.
 *
 * @deprecated use Repository.extend function to create a custom repository
 */
export function EntityRepository(
  entity?: ((...args: Array<unknown>) => unknown) | EntitySchema<unknown>
): ClassDecorator {
  return function (target): void {
    getMetadataArgsStorage().entityRepositories.push({
      target,
      entity,
    } as unknown as EntityRepositoryMetadataArgs);
  };
}
