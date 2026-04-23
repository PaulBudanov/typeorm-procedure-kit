import { ServerError } from './server-error.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$#]*$/;
const ROWID_PATTERN = /^[A-Za-z0-9+/=._-]+$/;

export abstract class SqlIdentifier {
  public static validateIdentifier(value: string, label: string): string {
    const normalized = value.trim();
    if (!IDENTIFIER_PATTERN.test(normalized)) {
      throw new ServerError(`Unsafe SQL identifier for ${label}: ${value}`);
    }
    return normalized;
  }

  public static validateQualifiedIdentifier(
    value: string,
    label: string
  ): string {
    return value
      .split('.')
      .map((part, index) =>
        SqlIdentifier.validateIdentifier(part, `${label}[${index}]`)
      )
      .join('.');
  }

  public static validateRowId(value: string): string {
    const normalized = value.trim();
    if (!ROWID_PATTERN.test(normalized)) {
      throw new ServerError(`Unsafe Oracle ROWID: ${value}`);
    }
    return normalized;
  }

  public static quotePostgresIdentifier(value: string): string {
    return `"${SqlIdentifier.validateIdentifier(value, 'postgres identifier')}"`;
  }

  public static quotePostgresQualifiedIdentifier(parts: Array<string>): string {
    return parts.map(SqlIdentifier.quotePostgresIdentifier).join('.');
  }

  public static formatOracleQualifiedIdentifier(parts: Array<string>): string {
    return parts
      .map((part) =>
        SqlIdentifier.validateIdentifier(
          part,
          'oracle identifier'
        ).toUpperCase()
      )
      .join('.');
  }
}
