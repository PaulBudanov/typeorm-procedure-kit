import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { ValueTransformer } from '../decorator/options/ValueTransformer.js';
import { ApplyValueTransformers } from '../util/ApplyValueTransformers.js';
import { InstanceChecker } from '../util/InstanceChecker.js';

import type { FindOperatorType } from './FindOperatorType.js';

type SqlGeneratorType = (aliasPath: string) => string;

/**
 * Find Operator used in Find Conditions.
 */
export class FindOperator<T> {
  public readonly '@instanceof' = Symbol.for('FindOperator');

  // -------------------------------------------------------------------------
  // Private Properties
  // -------------------------------------------------------------------------

  /**
   * Operator type.
   */
  private _type: FindOperatorType;

  /**
   * Parameter value.
   */
  private _value: T | FindOperator<T>;

  /**
   * ObjectLiteral parameters.
   */
  private _objectLiteralParameters: ObjectLiteral | undefined;

  /**
   * Indicates if parameter is used or not for this operator.
   */
  private _useParameter: boolean;

  /**
   * Indicates if multiple parameters must be used for this operator.
   */
  private _multipleParameters: boolean;

  /**
   * SQL generator
   */
  private _getSql: SqlGeneratorType | undefined;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    type: FindOperatorType,
    value: T | FindOperator<T>,
    useParameter = true,
    multipleParameters = false,
    getSql?: SqlGeneratorType,
    objectLiteralParameters?: ObjectLiteral
  ) {
    this._type = type;
    this._value = value;
    this._useParameter = useParameter;
    this._multipleParameters = multipleParameters;
    this._getSql = getSql;
    this._objectLiteralParameters = objectLiteralParameters;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Indicates if parameter is used or not for this operator.
   * Extracts final value if value is another find operator.
   */
  public get useParameter(): boolean {
    if (InstanceChecker.isFindOperator(this._value))
      return this._value.useParameter;

    return this._useParameter;
  }

  /**
   * Indicates if multiple parameters must be used for this operator.
   * Extracts final value if value is another find operator.
   */
  public get multipleParameters(): boolean {
    if (InstanceChecker.isFindOperator(this._value))
      return this._value.multipleParameters;

    return this._multipleParameters;
  }

  /**
   * Gets the Type of this FindOperator
   */
  public get type(): FindOperatorType {
    return this._type;
  }

  /**
   * Gets the final value needs to be used as parameter value.
   */
  public get value(): T {
    if (InstanceChecker.isFindOperator(this._value)) return this._value.value;

    return this._value;
  }

  /**
   * Gets ObjectLiteral parameters.
   */
  public get objectLiteralParameters(): ObjectLiteral | undefined {
    if (InstanceChecker.isFindOperator(this._value))
      return this._value.objectLiteralParameters;

    return this._objectLiteralParameters;
  }

  /**
   * Gets the child FindOperator if it exists
   */
  public get child(): FindOperator<T> | undefined {
    if (InstanceChecker.isFindOperator(this._value)) return this._value;

    return undefined;
  }

  /**
   * Gets the SQL generator
   */
  public get getSql(): SqlGeneratorType | undefined {
    if (InstanceChecker.isFindOperator(this._value)) return this._value.getSql;

    return this._getSql;
  }

  public transformValue(
    transformer: ValueTransformer | Array<ValueTransformer>
  ): void {
    if (this._value instanceof FindOperator) {
      this._value.transformValue(transformer);
    } else {
      this._value =
        Array.isArray(this._value) && this._multipleParameters
          ? (this._value.map(
              (v: T) =>
                transformer &&
                (ApplyValueTransformers.transformTo(transformer, v) as T)
            ) as unknown as FindOperator<T>)
          : (ApplyValueTransformers.transformTo(transformer, this._value) as T);
    }
  }
}
