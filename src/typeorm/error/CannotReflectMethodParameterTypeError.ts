import type { TFunction } from '../../types/utility.types.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when ORM cannot get method parameter's type.
 * Basically, when reflect-metadata is not available or tsconfig is not properly setup.
 */
export class CannotReflectMethodParameterTypeError extends TypeORMError {
  public constructor(target: TFunction, methodName: string) {
    super(
      `Cannot get reflected type for a "${methodName}" method's parameter of "${target.name}" class. ` +
        `Make sure you have turned on an "emitDecoratorMetadata": true option in tsconfig.json. ` +
        `Also make sure you have imported "reflect-metadata" on top of the main entry file in your application.`
    );
  }
}
