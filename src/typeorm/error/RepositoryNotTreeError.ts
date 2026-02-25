import type { TFunction } from '../../types/utility.types.js';
import { type EntityTarget } from '../common/EntityTarget.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when repository for the given class is not found.
 */
export class RepositoryNotTreeError extends TypeORMError {
  public constructor(entityClass: EntityTarget<unknown>) {
    super();

    let targetName: string;
    if (InstanceChecker.isEntitySchema(entityClass)) {
      targetName = (entityClass as EntitySchema).options.name;
    } else if (typeof entityClass === 'function') {
      targetName = (entityClass as unknown as TFunction).name;
    } else if (
      ObjectUtils.isObject(entityClass) &&
      'name' in (entityClass as object)
    ) {
      targetName = (entityClass as unknown as TFunction).name;
    } else {
      targetName = entityClass as string;
    }
    this.message = `Repository of the "${targetName}" class is not a TreeRepository. Try to apply @Tree decorator on your entity.`;
  }
}
