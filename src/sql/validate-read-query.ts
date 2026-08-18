export interface ReadQueryValidationOptions {
  largeTables?: string[];
}

export interface ValidatedReadQuery {
  kind: "select";
  sql: string;
  rowLimit: number;
  tables: string[];
}

interface Token {
  value: string;
  upper: string;
  start: number;
  end: number;
}

const BLOCKED_KEYWORDS = new Set([
  "ALTER",
  "CALL",
  "COMMIT",
  "CREATE",
  "DELETE",
  "DROP",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "INSERT",
  "INTERSECT",
  "MERGE",
  "MODIFY",
  "REVOKE",
  "ROLLBACK",
  "TRUNCATE",
  "UNION",
  "UPDATE",
  "UPSERT",
  "WITH",
]);

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < sql.length; ) {
    const character = sql[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === ";") {
      throw new Error("OpenSQL statement separators are not allowed");
    }
    if (
      character === '"' ||
      (character === "-" && sql[index + 1] === "-") ||
      (character === "/" && sql[index + 1] === "*") ||
      (character === "*" && sql[index + 1] === "/")
    ) {
      throw new Error(
        "OpenSQL comments and quoted identifiers are not allowed",
      );
    }
    if (character === "'") {
      const start = index;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1;
          continue;
        }
        if (sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      if (!closed) throw new Error("OpenSQL string literal is not closed");
      tokens.push({
        value: sql.slice(start, index),
        upper: "<STRING>",
        start,
        end: index,
      });
      continue;
    }
    const start = index;
    if (/[A-Za-z0-9_/$~.-]/.test(character)) {
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_/$~.-]/.test(sql[index])) {
        index += 1;
      }
    } else {
      index += 1;
    }
    const value = sql.slice(start, index);
    tokens.push({ value, upper: value.toUpperCase(), start, end: index });
  }
  return tokens;
}

function tableNames(tokens: Token[]): string[] {
  const tables: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].upper !== "FROM" && tokens[index].upper !== "JOIN")
      continue;
    const candidate = tokens[index + 1].upper;
    if (/^[A-Z0-9_/$]+$/.test(candidate)) tables.push(candidate);
  }
  return [...new Set(tables)];
}

export function validateReadQuery(
  source: string,
  maxRows: number,
  options: ReadQueryValidationOptions = {},
): ValidatedReadQuery {
  const sql = source.trim();
  if (!sql) throw new Error("OpenSQL query is required");
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("OpenSQL row limit must be a positive integer");
  }
  const hardLimit = Math.min(500, maxRows);
  const tokens = tokenize(sql);
  if (tokens[0]?.upper !== "SELECT") {
    throw new Error("Only one OpenSQL SELECT statement is allowed");
  }
  if (tokens.filter((token) => token.upper === "SELECT").length !== 1) {
    throw new Error("Nested or multiple SELECT statements are not allowed");
  }
  if (!tokens.some((token) => token.upper === "FROM")) {
    throw new Error("OpenSQL SELECT must contain FROM");
  }
  for (const [index, token] of tokens.entries()) {
    const countStar =
      token.upper === "*" &&
      tokens[index - 1]?.upper === "(" &&
      tokens[index - 2]?.upper === "COUNT" &&
      tokens[index + 1]?.upper === ")";
    if ((token.upper === "*" && !countStar) || /~\*$/.test(token.upper)) {
      throw new Error("OpenSQL wildcard columns are not allowed");
    }
    if (BLOCKED_KEYWORDS.has(token.upper)) {
      throw new Error(`OpenSQL keyword is not allowed: ${token.upper}`);
    }
  }

  const tables = tableNames(tokens);
  const largeTables = new Set(
    (options.largeTables ?? []).map((table) => table.trim().toUpperCase()),
  );
  if (
    tables.some((table) => largeTables.has(table)) &&
    !tokens.some((token) => token.upper === "WHERE")
  ) {
    throw new Error(
      "A selective WHERE clause is required for configured large tables",
    );
  }

  const upIndexes = tokens
    .map((token, index) => (token.upper === "UP" ? index : -1))
    .filter((index) => index >= 0);
  if (upIndexes.length > 1) throw new Error("OpenSQL row limit is ambiguous");
  if (upIndexes.length === 0) {
    return {
      kind: "select",
      sql: `${sql} UP TO ${hardLimit} ROWS`,
      rowLimit: hardLimit,
      tables,
    };
  }

  const upIndex = upIndexes[0];
  const sequence = tokens.slice(upIndex, upIndex + 4);
  if (
    sequence.length !== 4 ||
    sequence[1].upper !== "TO" ||
    !/^\d+$/.test(sequence[2].value) ||
    sequence[3].upper !== "ROWS" ||
    upIndex + 4 !== tokens.length
  ) {
    throw new Error("OpenSQL row limit must use trailing UP TO N ROWS");
  }
  const requested = Number(sequence[2].value);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error("OpenSQL row limit must be a positive integer");
  }
  const rowLimit = Math.min(requested, hardLimit);
  return {
    kind: "select",
    sql: `${sql.slice(0, sequence[2].start)}${rowLimit}${sql.slice(sequence[2].end)}`,
    rowLimit,
    tables,
  };
}
