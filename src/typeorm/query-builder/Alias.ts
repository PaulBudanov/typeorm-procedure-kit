import type { TFunction } from '../../types/utility.types.js';
import { TypeORMError } from '../error/TypeORMError.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

/**
 */
export class Alias {
  public type!: 'from' | 'select' | 'join' | 'other'; // todo: make something with "other"

  public name!: string;

  /**
   * Table on which this alias is applied.
   * Used only for aliases which select custom tables.
   */
  public tablePath?: string;

  /**
   * If this alias is for sub query.
   */
  public subQuery?: string;

  public constructor(alias?: Alias) {
    ObjectUtils.assign(this, alias || {});
  }

  private _metadata?: EntityMetadata;

  public get target(): TFunction | string {
    return this.metadata.target;
  }

  public get hasMetadata(): boolean {
    return !!this._metadata;
  }

  public set metadata(metadata: EntityMetadata) {
    this._metadata = metadata;
  }

  public get metadata(): EntityMetadata {
    if (!this._metadata)
      throw new TypeORMError(
        `Cannot get entity metadata for the given alias "${this.name}"`
      );

    return this._metadata;
  }
}
