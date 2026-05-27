interface NamedParameterMatch {
  full: string;
  isArray: boolean;
  key: string;
}

type NamedParameterReplacer = (match: NamedParameterMatch) => string;

function readDollarQuoteTag(sql: string, index: number): string | undefined {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
  return match?.[0];
}

function copyUntilSingleQuoteEnd(sql: string, index: number): number {
  let current = index + 1;
  while (current < sql.length) {
    if (sql[current] === "'" && sql[current + 1] === "'") {
      current += 2;
      continue;
    }
    if (sql[current] === "'") return current + 1;
    current += 1;
  }
  return sql.length;
}

function copyUntilBackslashSingleQuoteEnd(sql: string, index: number): number {
  let current = index + 1;
  while (current < sql.length) {
    if (sql[current] === '\\') {
      current += 2;
      continue;
    }
    if (sql[current] === "'" && sql[current + 1] === "'") {
      current += 2;
      continue;
    }
    if (sql[current] === "'") return current + 1;
    current += 1;
  }
  return sql.length;
}

function copyUntilDoubleQuoteEnd(sql: string, index: number): number {
  let current = index + 1;
  while (current < sql.length) {
    if (sql[current] === '"' && sql[current + 1] === '"') {
      current += 2;
      continue;
    }
    if (sql[current] === '"') return current + 1;
    current += 1;
  }
  return sql.length;
}

function copyUntilLineCommentEnd(sql: string, index: number): number {
  const newlineIndex = sql.indexOf('\n', index + 2);
  return newlineIndex === -1 ? sql.length : newlineIndex;
}

function copyUntilBlockCommentEnd(sql: string, index: number): number {
  const commentEndIndex = sql.indexOf('*/', index + 2);
  return commentEndIndex === -1 ? sql.length : commentEndIndex + 2;
}

function copyUntilDollarQuoteEnd(
  sql: string,
  index: number,
  tag: string
): number {
  const quoteEndIndex = sql.indexOf(tag, index + tag.length);
  return quoteEndIndex === -1 ? sql.length : quoteEndIndex + tag.length;
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function copyUntilOracleQuotedLiteralEnd(
  sql: string,
  index: number
): number | undefined {
  if (sql[index + 1] !== "'") return undefined;
  const openDelimiter = sql[index + 2];
  if (!openDelimiter) return undefined;

  const closeDelimiter =
    {
      '[': ']',
      '{': '}',
      '(': ')',
      '<': '>',
    }[openDelimiter] ?? openDelimiter;
  const endToken = `${closeDelimiter}'`;
  const quoteEndIndex = sql.indexOf(endToken, index + 3);
  return quoteEndIndex === -1 ? sql.length : quoteEndIndex + endToken.length;
}

function readParameterKey(sql: string, index: number): string {
  let current = index;
  while (current < sql.length && /[A-Za-z0-9_.]/.test(sql[current]!)) {
    current += 1;
  }
  return sql.slice(index, current);
}

export function replaceNamedParameters(
  sql: string,
  replacer: NamedParameterReplacer
): string {
  let result = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    const previous = sql[index - 1];

    if (
      (char === 'E' || char === 'e') &&
      next === "'" &&
      !isIdentifierPart(previous)
    ) {
      const end = copyUntilBackslashSingleQuoteEnd(sql, index + 1);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if (
      (char === 'U' || char === 'u') &&
      next === '&' &&
      sql[index + 2] === "'" &&
      !isIdentifierPart(previous)
    ) {
      const end = copyUntilSingleQuoteEnd(sql, index + 2);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if ((char === 'Q' || char === 'q') && !isIdentifierPart(previous)) {
      const end = copyUntilOracleQuotedLiteralEnd(sql, index);
      if (end !== undefined) {
        result += sql.slice(index, end);
        index = end;
        continue;
      }
    }

    if (char === "'") {
      const end = copyUntilSingleQuoteEnd(sql, index);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if (char === '"') {
      const end = copyUntilDoubleQuoteEnd(sql, index);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if (char === '-' && next === '-') {
      const end = copyUntilLineCommentEnd(sql, index);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = copyUntilBlockCommentEnd(sql, index);
      result += sql.slice(index, end);
      index = end;
      continue;
    }

    if (char === '$') {
      const tag = readDollarQuoteTag(sql, index);
      if (tag) {
        const end = copyUntilDollarQuoteEnd(sql, index, tag);
        result += sql.slice(index, end);
        index = end;
        continue;
      }
    }

    if (char === ':' && next === ':') {
      result += '::';
      index += 2;
      continue;
    }

    if (char === ':') {
      let parameterStart = index + 1;
      let isArray = false;
      if (sql.slice(parameterStart, parameterStart + 3) === '...') {
        isArray = true;
        parameterStart += 3;
      }

      const key = readParameterKey(sql, parameterStart);
      if (key.length > 0) {
        const parameterEnd = parameterStart + key.length;
        const full = sql.slice(index, parameterEnd);
        result += replacer({ full, isArray, key });
        index = parameterEnd;
        continue;
      }
    }

    result += char;
    index += 1;
  }

  return result;
}
