import type { TFunction } from '../../types/utility.types.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown if custom repositories that extend AbstractRepository classes does not have managed entity.
 */
export class CustomRepositoryDoesNotHaveEntityError extends TypeORMError {
  public constructor(repository: TFunction | object) {
    super(
      `Custom repository ${
        typeof repository === 'function'
          ? repository.name
          : repository.constructor.name
      } does not have managed entity. ` +
        `Did you forget to specify entity for it @EntityRepository(MyEntity)? `
    );
  }
}
