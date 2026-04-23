import type { PrimaryGeneratedColumnNumericOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnUUIDOptions.js';

interface IPrimaryGeneratedColumnUuid {
  strategy?: 'uuid';
  options?: PrimaryGeneratedColumnUUIDOptions;
}

interface IPrimaryGeneratedColumnNumeric {
  strategy?: 'increment';
  options?: PrimaryGeneratedColumnNumericOptions;
}

export type TExtendPrimaryGeneratedColumnOptions =
  | IPrimaryGeneratedColumnUuid
  | IPrimaryGeneratedColumnNumeric
  | PrimaryGeneratedColumnNumericOptions;

export type TPrimaryGeneratedColumnOverrideDescriptor =
  | {
      strategy?: 'increment';
      options?: PrimaryGeneratedColumnNumericOptions;
    }
  | {
      strategy?: 'uuid';
      options?: PrimaryGeneratedColumnUUIDOptions;
    };
