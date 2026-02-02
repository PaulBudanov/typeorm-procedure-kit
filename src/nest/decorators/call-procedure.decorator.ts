// import { SetMetadata } from '@nestjs/common';

// import { CALL_PROCEDURE } from '../consts.js';

// export interface CallOptions {
//   executeString: string;
//   params?: Record<string, unknown> | Array<unknown>;
//   options?: Array<string>;
// }

// export function Call(options: CallOptions): MethodDecorator {
//   return (
//     target: object,
//     propertyKey: string | symbol,
//     descriptor: TypedPropertyDescriptor
//   ) => {
//     SetMetadata(CALL_PROCEDURE, {
//       ...options,
//       propertyKey,
//     })(target, propertyKey as string);
//   };
// }
