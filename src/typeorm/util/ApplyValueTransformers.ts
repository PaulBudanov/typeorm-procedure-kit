import type { ValueTransformer } from '../decorator/options/ValueTransformer.js';

export class ApplyValueTransformers {
  public static transformFrom(
    transformer: ValueTransformer | Array<ValueTransformer>,
    databaseValue: unknown
  ): unknown {
    if (Array.isArray(transformer)) {
      const reverseTransformers = transformer.slice().reverse();
      return reverseTransformers.reduce((transformedValue, _transformer) => {
        return _transformer.from(transformedValue);
      }, databaseValue);
    }
    return transformer.from(databaseValue);
  }
  public static transformTo(
    transformer: ValueTransformer | Array<ValueTransformer>,
    entityValue: unknown
  ): unknown {
    if (Array.isArray(transformer)) {
      return transformer.reduce((transformedValue, _transformer) => {
        return _transformer.to(transformedValue);
      }, entityValue);
    }
    return transformer.to(entityValue);
  }
}
