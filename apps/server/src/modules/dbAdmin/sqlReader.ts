/**
 * A tolerant reader of the SQL the console ran, for index suggestions: which tables a statement
 * touches and which of their columns it filters on (equality, range), joins on, and sorts by.
 *
 * It is not a parser. It tokenizes (every engine's quoting), cuts a statement into its clauses at
 * the top level of its parentheses, and reads only the forms it is sure of: `column <op> value`,
 * `column IN (...)`, `column BETWEEN`, `a.x = b.y`, `JOIN … ON/USING`, `ORDER BY column`. What it
 * does not recognise — functions on a column, `OR`, `LIKE`, expressions, a dialect it does not
 * know — is left out; a statement it cannot read at all gives no block. It never throws.
 */

export interface TableRef {
  schema: string | null;
  name: string;
  alias: string | null;
}

export type ColumnUseKind = "eq" | "range" | "join" | "sort";

export interface ColumnUse {
  /** An alias or table name as written; `null` when the column was not qualified. */
  qualifier: string | null;
  column: string;
  kind: ColumnUseKind;
}

/** One `SELECT`, `UPDATE` or `DELETE` (a subquery or a `UNION` branch is a block of its own). */
export interface StatementBlock {
  tables: TableRef[];
  /** Some source is not a plain table (subquery, function): an unqualified column may belong to it. */
  hasDerivedSource: boolean;
  uses: ColumnUse[];
  /** `LIMIT`, `TOP`, `FETCH FIRST` or `ROWNUM`: a sort then only has to find the first rows. */
  limited: boolean;
}

interface Token {
  kind: "id" | "param" | "op" | "punct" | "sub";
  /** The text; for a quoted name, the name itself. */
  text: string;
  quoted?: boolean;
}

const MAX_TOKENS = 5_000;
const MAX_DEPTH = 8;

// ---- Tokens ------------------------------------------------------------------

/** What a scanner made of the text at a position: where it stops and the token it makes (none for blanks and comments). */
interface Scan {
  end: number;
  token?: Token;
}

const param = (end: number): Scan => ({ end, token: { kind: "param", text: "?" } });

function scanBlank(sql: string, i: number, engine: string | undefined): Scan | null {
  const c = sql[i];
  if (/\s/.test(c) || c === ";") return { end: i + 1 };
  if (sql.startsWith("--", i) || (c === "#" && engine === "mysql")) {
    const end = sql.indexOf("\n", i);
    return { end: end < 0 ? sql.length : end + 1 };
  }
  if (sql.startsWith("/*", i)) {
    const end = sql.indexOf("*/", i + 2);
    return { end: end < 0 ? sql.length : end + 2 };
  }
  return null;
}

/** A string literal, a doubled quote being an escaped one (and a backslash too on MySQL). */
function scanString(sql: string, i: number, engine: string | undefined): Scan | null {
  const c = sql[i];
  if (c !== "'" && !(c === '"' && engine === "mysql")) return null;
  let j = i + 1;
  while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) {
    j += sql[j] === c || (engine === "mysql" && sql[j] === "\\") ? 2 : 1;
  }
  return param(j + 1);
}

/** A quoted name (`"x"`, `` `x` ``, `[x]`); `end` is -1 when it is never closed. */
function scanQuotedName(sql: string, i: number, engine: string | undefined): Scan | null {
  const c = sql[i];
  const brackets = c === "[" && (engine === undefined || engine === "mssql" || engine === "sqlite");
  if (c !== '"' && c !== "`" && !brackets) return null;
  const close = c === "[" ? "]" : c;
  let j = i + 1;
  let name = "";
  while (j < sql.length && !(sql[j] === close && sql[j + 1] !== close)) {
    if (sql[j] === close) j++;
    name += sql[j++];
  }
  if (j >= sql.length) return { end: -1 };
  return { end: j + 1, token: { kind: "id", text: name, quoted: true } };
}

/** `?`, `$1`, `:name`, `@p1`, and numbers: values. */
function scanValue(sql: string, i: number): Scan | null {
  const c = sql[i];
  if (c === "?" || (/[$:@]/.test(c) && /\w/.test(sql[i + 1] ?? "") && sql[i - 1] !== ":")) {
    return param(i + (/^[?$:@]\w*/.exec(sql.slice(i, i + 80))?.[0].length ?? 1));
  }
  if (/\d/.test(c) || (c === "." && /\d/.test(sql[i + 1] ?? ""))) {
    return param(i + (/^(0x[0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(sql.slice(i, i + 80))?.[0].length ?? 1));
  }
  return null;
}

function scanWord(sql: string, i: number): Scan | null {
  if (!/[A-Za-z_\u0080-￿]/.test(sql[i])) return null;
  const word = /^[\w$#\u0080-￿]+/.exec(sql.slice(i, i + 200))![0];
  return { end: i + word.length, token: { kind: "id", text: word } };
}

function scanSymbol(sql: string, i: number): Scan {
  const c = sql[i];
  if (c === "(" || c === ")" || c === "," || c === ".") return { end: i + 1, token: { kind: "punct", text: c } };
  const op = /^(<=|>=|<>|!=|::|\|\||[=<>+\-*/%|&^~!])/.exec(sql.slice(i, i + 2))?.[0] ?? c;
  return { end: i + op.length, token: { kind: "op", text: op } };
}

function tokenize(sql: string, engine: string | undefined): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    if (tokens.length > MAX_TOKENS) return null;
    const scan =
      scanBlank(sql, i, engine) ??
      scanString(sql, i, engine) ??
      scanQuotedName(sql, i, engine) ??
      scanValue(sql, i) ??
      scanWord(sql, i) ??
      scanSymbol(sql, i);
    if (scan.end < 0) return null;
    if (scan.token) tokens.push(scan.token);
    i = scan.end;
  }
  return tokens;
}

const isWord = (token: Token | undefined, ...words: string[]): boolean =>
  token?.kind === "id" && !token.quoted && words.includes(token.text.toUpperCase());
const isPunct = (token: Token | undefined, text: string): boolean => token?.kind === "punct" && token.text === text;
const isOp = (token: Token | undefined, ...texts: string[]): boolean =>
  token?.kind === "op" && texts.includes(token.text);

/** The index of the `)` closing the `(` at `open`, or -1. */
function closingParen(tokens: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (isPunct(tokens[i], "(")) depth++;
    else if (isPunct(tokens[i], ")") && --depth === 0) return i;
  }
  return -1;
}

/** Positions at the top level of the parentheses, as a predicate over each token. */
function topLevel(tokens: Token[], visit: (token: Token, index: number) => void): void {
  let depth = 0;
  tokens.forEach((token, index) => {
    if (isPunct(token, ")")) depth = Math.max(0, depth - 1);
    if (depth === 0) visit(token, index);
    if (isPunct(token, "(")) depth++;
  });
}

function splitTop(tokens: Token[], isSeparator: (token: Token, index: number) => boolean): Token[][] {
  const parts: Token[][] = [];
  let from = 0;
  topLevel(tokens, (token, index) => {
    if (!isSeparator(token, index)) return;
    parts.push(tokens.slice(from, index));
    from = index + 1;
  });
  parts.push(tokens.slice(from));
  return parts;
}

// ---- Blocks ---------------------------------------------------------------------

/** Every readable statement block of `sql`, subqueries included; `[]` when it reads nothing. */
export function readStatement(sql: string, engine?: string): StatementBlock[] {
  try {
    const tokens = tokenize(sql, engine);
    if (!tokens) return [];
    const blocks: StatementBlock[] = [];
    readTokens(tokens, blocks, 0);
    return blocks;
  } catch {
    return [];
  }
}

const SET_OPERATORS = ["UNION", "INTERSECT", "EXCEPT", "MINUS"];

function readTokens(tokens: Token[], out: StatementBlock[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  // Subqueries become one `sub` token and a block of their own.
  const flat: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (isPunct(tokens[i], "(") && isWord(tokens[i + 1], "SELECT", "WITH")) {
      const close = closingParen(tokens, i);
      if (close > 0) {
        readTokens(tokens.slice(i + 1, close), out, depth + 1);
        flat.push({ kind: "sub", text: "(subquery)" });
        i = close;
        continue;
      }
    }
    flat.push(tokens[i]);
  }
  for (const branch of splitTop(flat, (token) => isWord(token, ...SET_OPERATORS))) {
    const block = readBlock(branch);
    if (block) out.push(block);
  }
}

const CLAUSES = ["FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "WINDOW", "FOR", "RETURNING"];

/** The clauses of a statement, each with the tokens after its keyword(s), keyed by the keyword. */
function clausesOf(tokens: Token[], extra: string[]): Map<string, Token[]> {
  const starts: { key: string; at: number; skip: number }[] = [];
  topLevel(tokens, (token, index) => {
    if (token.kind !== "id" || token.quoted) return;
    const word = token.text.toUpperCase();
    if (word === "GROUP" || word === "ORDER") {
      if (isWord(tokens[index + 1], "BY")) starts.push({ key: word, at: index, skip: 2 });
    } else if (CLAUSES.includes(word) || extra.includes(word)) {
      starts.push({ key: word, at: index, skip: 1 });
    }
  });
  const clauses = new Map<string, Token[]>();
  starts.forEach((start, n) => {
    if (clauses.has(start.key)) return;
    clauses.set(start.key, tokens.slice(start.at + start.skip, starts[n + 1]?.at ?? tokens.length));
  });
  return clauses;
}

function readBlock(tokens: Token[]): StatementBlock | null {
  let verb = -1;
  topLevel(tokens, (token, index) => {
    if (verb < 0 && isWord(token, "SELECT", "UPDATE", "DELETE")) verb = index;
  });
  if (verb < 0) return null;
  const kind = tokens[verb].text.toUpperCase();
  const body = tokens.slice(verb + 1);
  const block: StatementBlock = { tables: [], hasDerivedSource: false, uses: [], limited: false };
  let where: Token[] | undefined;
  let orderBy: Token[] | undefined;

  if (kind === "SELECT") {
    const clauses = clausesOf(body, []);
    block.limited = isWord(body[0], "TOP") || isWord(body[1], "TOP") || ["LIMIT", "FETCH"].some((k) => clauses.has(k));
    const from = clauses.get("FROM");
    if (!from) return null;
    readSources(from, block);
    where = clauses.get("WHERE");
    orderBy = clauses.get("ORDER");
  } else if (kind === "UPDATE") {
    const clauses = clausesOf(body, ["SET"]);
    // `UPDATE t [JOIN u ON …] SET …` takes its sources before SET; PostgreSQL adds a FROM after it.
    const setAt = clauses.has("SET") ? body.findIndex((token) => isWord(token, "SET")) : -1;
    readSources(setAt < 0 ? [] : body.slice(0, setAt), block);
    const from = clauses.get("FROM");
    if (from) readSources(from, block);
    where = clauses.get("WHERE");
  } else {
    const clauses = clausesOf(body, ["USING"]);
    const from = clauses.get("FROM");
    if (!from) return null;
    readSources(from, block);
    const using = clauses.get("USING");
    if (using) readSources(using, block);
    where = clauses.get("WHERE");
  }

  if (block.tables.length === 0) return null;
  if (where) block.uses.push(...readConditions(where));
  if (orderBy) block.uses.push(...readSort(orderBy));
  if (where && where.some((token) => isWord(token, "ROWNUM"))) block.limited = true;
  // Two columns of the one table compared with each other are no join.
  if (block.tables.length === 1) block.uses = block.uses.filter((use) => use.kind !== "join");
  return block.uses.length > 0 ? block : null;
}

// ---- Sources (FROM / JOIN) -------------------------------------------------------

const JOIN_WORDS = ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER", "STRAIGHT_JOIN", "APPLY"];
/** Words that are not an alias when they follow a table name. */
const NOT_ALIASES = [
  ...JOIN_WORDS,
  "ON",
  "USING",
  "WITH",
  "USE",
  "FORCE",
  "IGNORE",
  "TABLESAMPLE",
  "WHERE",
  "SET",
  "LATERAL",
];

function skipGroup(tokens: Token[], i: number): number {
  const close = isPunct(tokens[i], "(") ? closingParen(tokens, i) : -1;
  return close < 0 ? i : close + 1;
}

/** An optional `[AS] alias` (and its column list) at `i`. */
function readAlias(tokens: Token[], i: number): { alias: string | null; next: number } {
  const at = isWord(tokens[i], "AS") ? i + 1 : i;
  const token = tokens[at];
  if (token?.kind !== "id" || (!token.quoted && isWord(token, ...NOT_ALIASES))) return { alias: null, next: i };
  return { alias: token.text, next: skipGroup(tokens, at + 1) };
}

/** MSSQL `WITH (NOLOCK)` and MySQL `USE INDEX (…)` hints. */
function skipHints(tokens: Token[], i: number): number {
  let next = i;
  while (isWord(tokens[next], "WITH", "USE", "FORCE", "IGNORE")) {
    next++;
    while (tokens[next]?.kind === "id") next++;
    next = skipGroup(tokens, next);
  }
  return next;
}

/** `ON <condition>`: the condition runs to the next join or comma at this level. Returns where it ends. */
function readOn(tokens: Token[], i: number, block: StatementBlock): number {
  let end = i + 1;
  let depth = 0;
  for (; end < tokens.length; end++) {
    if (isPunct(tokens[end], "(")) depth++;
    else if (isPunct(tokens[end], ")")) depth--;
    else if (depth === 0 && (isPunct(tokens[end], ",") || isWord(tokens[end], ...JOIN_WORDS))) break;
  }
  block.uses.push(...readConditions(tokens.slice(i + 1, end)));
  return end;
}

/** `USING (a, b)`: the columns join the table just read with the one before it. */
function readUsing(tokens: Token[], i: number, block: StatementBlock): number {
  const close = closingParen(tokens, i + 1);
  const columns = tokens.slice(i + 2, close < 0 ? tokens.length : close).filter((t) => t.kind === "id");
  const joined = block.tables.slice(-2);
  for (const column of columns) {
    for (const ref of joined) {
      if (ref) block.uses.push({ qualifier: ref.alias ?? ref.name, column: column.text, kind: "join" });
    }
  }
  return close < 0 ? tokens.length : close + 1;
}

/** A subquery, or anything that is not a name, used as a source: skipped with its alias. */
function readDerivedSource(tokens: Token[], i: number, block: StatementBlock): number {
  block.hasDerivedSource = true;
  return readAlias(tokens, i + 1).next;
}

/** A (possibly qualified) table name with its alias; a function used as a source is a derived one. */
function readNamedSource(tokens: Token[], i: number, block: StatementBlock): number {
  const parts = [tokens[i].text];
  let next = i + 1;
  while (isPunct(tokens[next], ".") && tokens[next + 1]?.kind === "id") {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  if (isPunct(tokens[next], "(")) {
    block.hasDerivedSource = true;
    return readAlias(tokens, skipGroup(tokens, next)).next;
  }
  const { alias, next: afterAlias } = readAlias(tokens, next);
  if (parts.length > 3) {
    block.hasDerivedSource = true;
  } else {
    block.tables.push({
      name: parts[parts.length - 1],
      schema: parts.length >= 2 ? parts[parts.length - 2] : null,
      alias,
    });
  }
  return skipHints(tokens, afterAlias);
}

function readSources(tokens: Token[], block: StatementBlock): void {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (isPunct(token, ",") || isPunct(token, "(") || isPunct(token, ")")) i++;
    else if (isWord(token, ...JOIN_WORDS, "ONLY", "LATERAL")) i++;
    else if (isWord(token, "ON")) i = readOn(tokens, i, block);
    else if (isWord(token, "USING") && isPunct(tokens[i + 1], "(")) i = readUsing(tokens, i, block);
    else i = token.kind === "id" ? readNamedSource(tokens, i, block) : readDerivedSource(tokens, i, block);
  }
}

// ---- Conditions ------------------------------------------------------------------

interface Operand {
  next: number;
  /** A column reference; absent for a value. */
  column?: { qualifier: string | null; name: string };
}

const VALUE_WORDS = ["NULL", "TRUE", "FALSE", "CURRENT_DATE", "CURRENT_TIMESTAMP", "CURRENT_TIME", "SYSDATE", "NOW"];
const NOT_COLUMNS = ["ROWNUM", "ROWID", "NOT", "EXISTS", "CASE", "CAST", "INTERVAL", "DATE", "TIMESTAMP"];

/** A column reference or a value at `i`; `null` when it is anything else (function, expression, group). */
function readOperand(tokens: Token[], i: number): Operand | null {
  const token = tokens[i];
  if (!token) return null;
  if (token.kind === "param" || token.kind === "sub") return { next: i + 1 };
  if (token.kind === "op" && (token.text === "-" || token.text === "+") && tokens[i + 1]?.kind === "param") {
    return { next: i + 2 };
  }
  if (token.kind !== "id") return null;
  if (!token.quoted && VALUE_WORDS.includes(token.text.toUpperCase())) {
    return { next: isPunct(tokens[i + 1], "(") ? skipGroup(tokens, i + 1) : i + 1 };
  }
  if (!token.quoted && NOT_COLUMNS.includes(token.text.toUpperCase())) return null;
  const parts = [token.text];
  let next = i + 1;
  while (isPunct(tokens[next], ".") && tokens[next + 1]?.kind === "id") {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  if (isPunct(tokens[next], "(") || parts.length > 3) return null;
  // `col::type`, `col + 1`: an expression on the column, which an index on the column does not serve.
  if (isOp(tokens[next], "::", "+", "-", "*", "/", "%", "||")) return null;
  return {
    next,
    column: { qualifier: parts.length >= 2 ? parts[parts.length - 2] : null, name: parts[parts.length - 1] },
  };
}

/** `AND`-separated predicates, `BETWEEN … AND …` kept whole, parenthesised groups opened; an `OR` gives the group up. */
function conjuncts(tokens: Token[], depth = 0): Token[][] {
  if (depth > MAX_DEPTH || tokens.length === 0) return [];
  if (splitTop(tokens, (token) => isWord(token, "OR")).length > 1) return [];
  const parts: Token[][] = [];
  let from = 0;
  let pendingBetween = 0;
  topLevel(tokens, (token, index) => {
    if (isWord(token, "BETWEEN")) pendingBetween++;
    else if (isWord(token, "AND")) {
      if (pendingBetween > 0) {
        pendingBetween--;
        return;
      }
      parts.push(tokens.slice(from, index));
      from = index + 1;
    }
  });
  parts.push(tokens.slice(from));
  return parts.flatMap((part) => {
    if (isPunct(part[0], "(") && closingParen(part, 0) === part.length - 1)
      return conjuncts(part.slice(1, -1), depth + 1);
    return [part];
  });
}

/** The column uses of a `WHERE` or `ON` condition. */
function readConditions(tokens: Token[]): ColumnUse[] {
  const uses: ColumnUse[] = [];
  const use = (column: Operand["column"], kind: ColumnUseKind) => {
    if (column) uses.push({ qualifier: column.qualifier, column: column.name, kind });
  };
  for (const part of conjuncts(tokens)) {
    const left = readOperand(part, 0);
    if (!left) continue;
    const at = part[left.next];
    let right: Operand | null = null;
    let kind: ColumnUseKind | null = null;
    if (isOp(at, "=")) {
      right = readOperand(part, left.next + 1);
      kind = "eq";
    } else if (isOp(at, "<", ">", "<=", ">=")) {
      right = readOperand(part, left.next + 1);
      kind = "range";
    } else if (isWord(at, "BETWEEN")) {
      right = { next: left.next + 1 };
      kind = "range";
    } else if (isWord(at, "IN") && (isPunct(part[left.next + 1], "(") || part[left.next + 1]?.kind === "sub")) {
      right = { next: left.next + 1 };
      kind = "eq";
    } else if (isWord(at, "IS") && isWord(part[left.next + 1], "NULL")) {
      right = { next: left.next + 2 };
      kind = "eq";
    }
    if (!kind || !right) continue;
    if (!left.column && !right.column) continue;
    if (left.column && right.column) {
      // Two columns: a join when they belong to different tables (or neither says), else nothing to learn.
      const same =
        left.column.qualifier === right.column.qualifier &&
        (left.column.qualifier !== null || left.column.name === right.column.name);
      if (kind === "eq" && !same) {
        use(left.column, "join");
        use(right.column, "join");
      }
    } else {
      const column = left.column ?? right.column;
      use(column, kind === "range" ? "range" : "eq");
    }
  }
  return uses;
}

/** `ORDER BY` columns up to the first item that is not a plain column. */
function readSort(tokens: Token[]): ColumnUse[] {
  const uses: ColumnUse[] = [];
  for (const item of splitTop(tokens, (token) => isPunct(token, ","))) {
    const operand = readOperand(item, 0);
    if (!operand?.column) break;
    const rest = item.slice(operand.next);
    // Only a direction, NULLS FIRST/LAST or a COLLATE may follow.
    const plain = rest.every(
      (token, i) =>
        isWord(token, "ASC", "DESC", "NULLS", "FIRST", "LAST", "COLLATE") ||
        (isWord(rest[i - 1], "COLLATE") && token.kind === "id"),
    );
    if (!plain) break;
    uses.push({ qualifier: operand.column.qualifier, column: operand.column.name, kind: "sort" });
  }
  return uses;
}
