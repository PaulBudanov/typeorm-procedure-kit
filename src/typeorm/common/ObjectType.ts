import type { TFunction } from '../../types/utility.types.js';

/**
 * Represents some Type of the Object.
 */
export type ObjectType<T> = (new () => T) | TFunction;
