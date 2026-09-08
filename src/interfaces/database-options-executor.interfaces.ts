import type { TOptionCommandDialect } from '../types/database-options-executor.types.js';

export interface IValidatedOptionCommand {
  command: string;
  dialect: TOptionCommandDialect;
  oracleParameter?: string;
}
