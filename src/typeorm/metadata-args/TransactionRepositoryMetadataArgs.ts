import type { TFunction } from '../../types/utility.types.js';

/**
 * Used to inject transaction's repository into the method wrapped with @Transaction decorator.
 */
export interface TransactionRepositoryMetadataArgs {
  /**
   * Target class on which decorator is used.
   */
  readonly target: TFunction;

  /**
   * Method on which decorator is used.
   */
  readonly methodName: string;

  /**
   * Index of the parameter on which decorator is used.
   */
  readonly index: number;

  /**
   * Type of the repository class (Repository, TreeRepository or MongoRepository) or custom repository class.
   */
  readonly repositoryType: TFunction;

  /**
   * Argument of generic Repository<T> class if it's not custom repository class.
   */
  readonly entityType?: TFunction;
}
