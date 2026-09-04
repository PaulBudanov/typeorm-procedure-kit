import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import type { IProcedureStructuredType } from '../../types/procedure.types.js';

/** Quotes a metadata-derived PostgreSQL composite type as a SQL identifier. */
export function quotePostgreCompositeType(
  structuredType: IProcedureStructuredType
): string {
  if (structuredType.kind !== 'postgres-composite') {
    throw new ServerError(
      `Unsupported PostgreSQL structured type kind: ${structuredType.kind}`
    );
  }
  if (structuredType.schema === undefined) {
    throw new ServerError(
      `PostgreSQL composite type "${structuredType.typeName}" is missing its schema`
    );
  }
  return SqlIdentifier.quotePostgresQualifiedIdentifier([
    structuredType.schema,
    structuredType.typeName,
  ]);
}

/** Enforces the deliberately flat first-version composite contract. */
export function assertSupportedPostgreComposite(
  argumentType: string | undefined,
  structuredType: IProcedureStructuredType
): void {
  const qualifiedType = quotePostgreCompositeType(structuredType);
  if (argumentType?.trim().endsWith('[]') === true) {
    throw new ServerError(
      `PostgreSQL composite arrays are not supported: ${qualifiedType}[]`
    );
  }
  const nestedField = structuredType.fields.find(
    (field) => field.typeName !== undefined
  );
  if (nestedField !== undefined) {
    throw new ServerError(
      `Nested PostgreSQL composites are not supported: ${qualifiedType}.${SqlIdentifier.quotePostgresIdentifier(
        nestedField.name
      )}`
    );
  }
}
