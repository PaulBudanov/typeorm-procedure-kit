import type { TFunction } from '../../types/utility.types.js';
import { type EntityTarget } from '../common/EntityTarget.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when no result could be found in methods which are not allowed to return undefined or an empty set.
 */
export class EntityNotFoundError extends TypeORMError {
  public readonly entityClass: EntityTarget<unknown>;
  public readonly criteria: unknown;

  public constructor(entityClass: EntityTarget<unknown>, criteria: unknown) {
    super();

    this.entityClass = entityClass;
    this.criteria = criteria;

    this.message =
      `Could not find any entity of type "${this.stringifyTarget(
        entityClass
      )}" ` + `matching: ${this.stringifyCriteria(criteria)}`;
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

  private stringifyCriteria(criteria: unknown): string {
    try {
      return JSON.stringify(criteria, null, 4);
    } catch {
      return '' + criteria;
    }
  }
}
