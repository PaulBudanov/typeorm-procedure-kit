import { ServerError } from './server-error.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$#]*$/;
const ROWID_PATTERN = /^[A-Za-z0-9+/=._-]+$/;

class SqlIdentifierApi {
  public validateIdentifier(value: string, label: string): string {
    const normalized = value.trim();
    if (!IDENTIFIER_PATTERN.test(normalized)) {
      throw new ServerError(`Unsafe SQL identifier for ${label}: ${value}`);
    }
    return normalized;
  }

  public validateQualifiedIdentifier(value: string, label: string): string {
    return value
      .split('.')
      .map((part, index) => this.validateIdentifier(part, `${label}[${index}]`))
      .join('.');
  }

  public validateRowId(value: string): string {
    const normalized = value.trim();
    if (!ROWID_PATTERN.test(normalized)) {
      throw new ServerError(`Unsafe Oracle ROWID: ${value}`);
    }
    return normalized;
  }

  public quotePostgresIdentifier(value: string): string {
    return `"${this.validateIdentifier(value, 'postgres identifier')}"`;
  }

  public quotePostgresQualifiedIdentifier(parts: Array<string>): string {
    return parts.map((part) => this.quotePostgresIdentifier(part)).join('.');
  }

  public formatOracleQualifiedIdentifier(parts: Array<string>): string {
    return parts
      .map((part) =>
        this.validateIdentifier(part, 'oracle identifier').toUpperCase()
      )
      .join('.');
  }
}

const sqlIdentifier = new SqlIdentifierApi();

export { sqlIdentifier as SqlIdentifier };
