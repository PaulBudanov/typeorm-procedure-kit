import { TypeORMError } from './TypeORMError.js';

export class QueryRunnerAlreadyReleasedError extends TypeORMError {
  public constructor() {
    super(`Query runner already released. Cannot run queries anymore.`);
  }
}
