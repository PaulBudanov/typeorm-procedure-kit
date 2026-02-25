import type { TFunction } from '../../types/utility.types.js';
import { type EntityTarget } from '../common/EntityTarget.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { TypeORMError } from './TypeORMError.js';

export class EntityMetadataNotFoundError extends TypeORMError {
  public constructor(target: EntityTarget<unknown>) {
    super();

    this.message = `No metadata for "${this.stringifyTarget(
      target
    )}" was found.`;
  }

  private stringifyTarget(target: EntityTarget<unknown>): string {
    if (InstanceChecker.isEntitySchema(target)) {
      return (target as EntitySchema).options.name;
    } else if (typeof target === 'function') {
      return (target as unknown as TFunction).name;
    } else if (ObjectUtils.isObject(target) && 'name' in (target as object)) {
      return (target as unknown as TFunction).name;
    } else {
      return target as string;
    }
  }
}
