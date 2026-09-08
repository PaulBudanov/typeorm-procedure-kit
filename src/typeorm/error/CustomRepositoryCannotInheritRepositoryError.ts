import { TypeORMError } from './TypeORMError.js';

import type { TFunction } from '../../types/utility.types.js';

/**
 * Thrown if custom repository inherits Repository class however entity is not set in @EntityRepository decorator.
 */
export class CustomRepositoryCannotInheritRepositoryError extends TypeORMError {
  public constructor(repository: TFunction | object) {
    super(
      `Custom entity repository ${
        typeof repository === 'function'
          ? repository.name
          : repository.constructor.name
      } ` +
        ` cannot inherit Repository class without entity being set in the @EntityRepository decorator.`
    );
  }
}
