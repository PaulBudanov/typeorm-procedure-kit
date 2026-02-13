import type { IsolationLevel } from '../../driver/types/IsolationLevel.js';

export interface TransactionOptions {
  connectionName?: string;
  isolation?: IsolationLevel;
}
