import type { IProcedureArgumentBase } from './procedure.interfaces.js';

export interface IProcedureMetadataOptions {
  vendor: 'Database' | 'Oracle' | 'PostgreSQL';
  noArgumentSentinel?: string;
  getOverloadIdentity?: (argument: IProcedureArgumentBase) => unknown;
}
