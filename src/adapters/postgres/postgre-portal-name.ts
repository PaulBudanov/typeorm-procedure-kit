import { randomUUID } from 'crypto';

import { ServerError } from '../../utils/server-error.js';

/** Policy error that carries the only server value safe to close explicitly. */
export class PostgreUnnamedPortalError extends ServerError {
  public constructor(
    public readonly portalName: string,
    argumentName: string
  ) {
    super(
      `Unsafe PostgreSQL unnamed portal for cursor "${argumentName}"; refcursor outputs, including pure OUT, must return an explicit portal name`
    );
    this.name = 'PostgreUnnamedPortalError';
  }
}

/** PostgreSQL portal naming and SQL-identifier safety policy. */
export class PostgrePortalName {
  private static readonly MAX_NAME_BYTES = 63;
  private static readonly UNNAMED_PORTAL_PATTERN =
    /^<\s*unnamed\s+portal(?:\s+[^>]*)?\s*>$/iu;

  public normalizeInput(value: unknown, argumentName: string): string {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0)
    ) {
      return `tpk_${randomUUID().replaceAll('-', '_')}`;
    }
    if (typeof value !== 'string') {
      throw new TypeError(
        `PostgreSQL refcursor "${argumentName}" must be a string portal name`
      );
    }
    return this.assertSafe(value, argumentName);
  }

  public assertReturned(value: unknown, argumentName: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ServerError(
        `PostgreSQL cursor "${argumentName}" did not return a portal name`
      );
    }
    this.assertCommonSafety(value, argumentName);
    if (PostgrePortalName.UNNAMED_PORTAL_PATTERN.test(value.trim())) {
      throw new PostgreUnnamedPortalError(value, argumentName);
    }
    return value;
  }

  public quote(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }

  private assertSafe(value: string, argumentName: string): string {
    this.assertCommonSafety(value, argumentName);
    if (PostgrePortalName.UNNAMED_PORTAL_PATTERN.test(value.trim())) {
      throw new ServerError(
        `Unsafe PostgreSQL portal name for cursor "${argumentName}"`
      );
    }
    return value;
  }

  private assertCommonSafety(value: string, argumentName: string): void {
    if (
      /\p{Cc}/u.test(value) ||
      Buffer.byteLength(value, 'utf8') > PostgrePortalName.MAX_NAME_BYTES
    ) {
      throw new ServerError(
        `Unsafe PostgreSQL portal name for cursor "${argumentName}"`
      );
    }
  }
}
