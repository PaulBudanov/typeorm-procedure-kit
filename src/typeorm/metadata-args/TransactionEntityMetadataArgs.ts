import type { TFunction } from '../../types/utility.types.js';

/**
 * Used to inject transaction's entity managed into the method wrapped with @Transaction decorator.
 */
export interface TransactionEntityMetadataArgs {
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
}
