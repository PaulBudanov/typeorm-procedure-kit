import dedent from 'dedent';

import { ServerError } from '../../utils/server-error.js';
import type { Driver } from '../driver/Driver.js';

const SQL_RAW_SYMBOL = Symbol.for('typeorm-procedure-kit.sql.raw');
const SQL_IDENTIFIER_SYMBOL = Symbol.for(
  'typeorm-procedure-kit.sql.identifier'
);
const SQL_PARAMETER_LIST_SYMBOL = Symbol.for(
  'typeorm-procedure-kit.sql.parameter-list'
);

interface BuildSqlTagParams {
  driver: Driver;
  strings: TemplateStringsArray;
  expressions: Array<unknown>;
}

interface UnsafeRawSqlExpression {
  readonly [SQL_RAW_SYMBOL]: true;
  readonly sql: string;
}

interface SqlIdentifierExpression {
  readonly [SQL_IDENTIFIER_SYMBOL]: true;
  readonly parts: Array<string>;
}

interface SqlParameterListExpression {
  readonly [SQL_PARAMETER_LIST_SYMBOL]: true;
  readonly values: Array<unknown>;
}

export function unsafeRawSql(sql: string): UnsafeRawSqlExpression {
  return { [SQL_RAW_SYMBOL]: true, sql };
}

export function sqlIdentifier(
  ...parts: Array<string>
): SqlIdentifierExpression {
  return { [SQL_IDENTIFIER_SYMBOL]: true, parts };
}

export function sqlParameterList(
  values: ReadonlyArray<unknown>
): SqlParameterListExpression {
  return { [SQL_PARAMETER_LIST_SYMBOL]: true, values: [...values] };
}

function isUnsafeRawSqlExpression(
  value: unknown
): value is UnsafeRawSqlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[SQL_RAW_SYMBOL] === true
  );
}

function isSqlIdentifierExpression(
  value: unknown
): value is SqlIdentifierExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[SQL_IDENTIFIER_SYMBOL] === true
  );
}

function isSqlParameterListExpression(
  value: unknown
): value is SqlParameterListExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[SQL_PARAMETER_LIST_SYMBOL] === true
  );
}

export function buildSqlTag({
  driver,
  strings,
  expressions,
}: BuildSqlTagParams): { query: string; parameters: Array<unknown> } {
  let query = '';
  const parameters: Array<unknown> = [];
  let idx = 0;

  for (const [expressionIdx, expression] of expressions.entries()) {
    query += strings[expressionIdx];

    if (isUnsafeRawSqlExpression(expression)) {
      query += expression.sql;
      continue;
    }

    if (isSqlIdentifierExpression(expression)) {
      if (expression.parts.length === 0) {
        throw new ServerError(
          'SQL identifier expressions require at least one part.'
        );
      }
      query += expression.parts.map((part) => driver.escape(part)).join('.');
      continue;
    }

    if (isSqlParameterListExpression(expression)) {
      if (expression.values.length === 0) {
        throw new ServerError(
          `Expression ${expressionIdx} in this sql tagged template is an empty parameter list. Empty arrays cannot safely be expanded into parameter lists.`
        );
      }
      const arrayParams = expression.values.map(() => {
        return driver.createParameter(`param_${idx + 1}`, idx++);
      });
      query += arrayParams.join(', ');
      parameters.push(...expression.values);
      continue;
    }

    if (expression === null) {
      query += 'NULL';
      continue;
    }

    if (typeof expression === 'function') {
      const value: unknown = (expression as () => unknown)();

      if (Array.isArray(value)) {
        if (value.length === 0) {
          throw new ServerError(
            `Expression ${expressionIdx} in this sql tagged template is a function which returned an empty array. Empty arrays cannot safely be expanded into parameter lists.`
          );
        }
        const arrayParams = value.map(() => {
          return driver.createParameter(`param_${idx + 1}`, idx++);
        });
        query += arrayParams.join(', ');
        parameters.push(...(value as Array<unknown>));
        continue;
      }

      throw new ServerError(
        `Expression ${expressionIdx} in this sql tagged template is a function which returned a value of type "${
          value === null ? 'null' : typeof value
        }". Only non-empty arrays are supported as function return values; use unsafeRawSql(), sqlIdentifier(), or sqlParameterList() explicitly for raw SQL, identifiers, or parameter lists.`
      );
    }

    query += driver.createParameter(`param_${idx + 1}`, idx++);

    parameters.push(expression);
  }

  query += strings[strings.length - 1];

  query = dedent(query);

  return { query, parameters };
}
