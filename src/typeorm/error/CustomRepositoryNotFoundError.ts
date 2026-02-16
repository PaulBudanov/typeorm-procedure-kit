import type { TFunction } from '../../types/utility.types.js';
import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown if custom repository was not found.
 */
export class CustomRepositoryNotFoundError extends TypeORMError {
  public constructor(repository: TFunction | object) {
    super(
      `Custom repository ${
        typeof repository === 'function'
          ? repository.name
          : repository.constructor.name
      } was not found. ` +
        `Did you forgot to put @EntityRepository decorator on it?`
    );
  }
}
