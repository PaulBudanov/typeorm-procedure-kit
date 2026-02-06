import { merge } from 'lodash-es';
import type { ColumnOptions } from 'typeorm';

export abstract class TypeOrmMergeHelper {
  public static mergeColumnOptions(
    target: ColumnOptions,
    overrideSource: Partial<ColumnOptions>
  ): ColumnOptions {
    return merge(target, overrideSource);
  }
  public static mergeClasses<T>(target: T, overrideSource: Partial<T>): T {
    return merge(target, overrideSource);
  }
}
