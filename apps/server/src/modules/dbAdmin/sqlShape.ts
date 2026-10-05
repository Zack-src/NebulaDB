/**
 * The shape of a SQL statement, for the SQL console's statistics: the same
 * statement run with other values has the same shape, and the shape holds
 * none of the values.
 */

const MAX_NORMALIZED_LENGTH = 2_000;

/** What a scanner made of the text at a position: where it stops, what replaces it, and how much of the output to drop first (a string's prefix). */
interface Scanned {
  end: number;
  text: string;
  drop?: number;
}
type Scanner = (sql: string, i: number, out: string, engine: string | undefined) => Scanned | null;

const after = (sql: string, end: number, length: number) => (end < 0 ? sql.length : end + length);
const QUOTE_PAIRS: Record<string, string> = { "[": "]", "{": "}", "<": ">", "(": ")" };

function scanLineComment(sql: string, i: number, _out: string, engine: string | undefined): Scanned | null {
  if (!sql.startsWith("--", i) && !(sql[i] === "#" && engine === "mysql")) return null;
  const end = sql.indexOf("\n", i);
  return { end: end < 0 ? sql.length : end, text: " " };
}

function scanBlockComment(sql: string, i: number): Scanned | null {
  return sql.startsWith("/*", i) ? { end: after(sql, sql.indexOf("*/", i + 2), 2), text: " " } : null;
}

/** Oracle alternative quoting: q'[...]', q'{...}', q'<...>', q'(...)', q'X...X'. */
function scanOracleQuote(sql: string, i: number): Scanned | null {
  if (!/[qQ]/.test(sql[i]) || sql[i + 1] !== "'" || /[\w$]/.test(sql[i - 1] ?? "") || i + 2 >= sql.length) return null;
  const close = QUOTE_PAIRS[sql[i + 2]] ?? sql[i + 2];
  return { end: after(sql, sql.indexOf(`${close}'`, i + 3), 2), text: "?" };
}

/** String literals, with an optional N / E / B / X prefix; a doubled quote is an escaped one. */
function scanString(sql: string, i: number, out: string, engine: string | undefined): Scanned | null {
  const quote = sql[i];
  if (quote !== "'" && !(quote === '"' && engine === "mysql")) return null;
  const prefixed = /[NnEeBbXx]$/.test(out) && !/[\w$]/.test(out[out.length - 2] ?? "");
  // MySQL strings, and PostgreSQL E'...' ones, take backslash escapes.
  const backslash = engine === "mysql" || (prefixed && /[Ee]$/.test(out));
  let j = i + 1;
  while (j < sql.length && !(sql[j] === quote && sql[j + 1] !== quote)) {
    j += (backslash && sql[j] === "\\") || sql[j] === quote ? 2 : 1;
  }
  return { end: j + 1, text: "?", drop: prefixed ? 1 : 0 };
}

/** PostgreSQL dollar quoting: $$...$$ or $tag$...$tag$ (not $1, a parameter). */
function scanDollarQuote(sql: string, i: number, _out: string, engine: string | undefined): Scanned | null {
  if (sql[i] !== "$" || engine === "mssql") return null;
  const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64));
  return tag ? { end: after(sql, sql.indexOf(tag[0], i + tag[0].length), tag[0].length), text: "?" } : null;
}

/** Quoted identifiers are names, not values: kept whole. */
function scanQuotedName(sql: string, i: number): Scanned | null {
  if (!'"`['.includes(sql[i])) return null;
  const end = after(sql, sql.indexOf(sql[i] === "[" ? "]" : sql[i], i + 1), 1);
  return { end, text: sql.slice(i, end) };
}

/** Numbers (and hex) that are not part of a name or a parameter ($1, :1, @p1). */
function scanNumber(sql: string, i: number, out: string): Scanned | null {
  if (/[\w$:@.]/.test(out[out.length - 1] ?? "")) return null;
  const number = /^(0x[0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(sql.slice(i, i + 400));
  return number ? { end: i + number[0].length, text: "?" } : null;
}

const SCANNERS: Scanner[] = [
  scanLineComment,
  scanBlockComment,
  scanOracleQuote,
  scanString,
  scanDollarQuote,
  scanQuotedName,
  scanNumber,
];

/**
 * Comments dropped, every string, number, hex and dollar-quoted literal
 * replaced by `?`, lists of them collapsed, whitespace collapsed. Identifiers
 * are kept as written (quoted ones too), except on MySQL, where a
 * double-quoted token is a string unless ANSI_QUOTES is on — read as one, the
 * safe reading for a statistic that must hold no value.
 */
export function normalizeSql(sql: string, engine?: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    let scanned: Scanned | null = null;
    for (const scan of SCANNERS) {
      scanned = scan(sql, i, out, engine);
      if (scanned) break;
    }
    if (!scanned) {
      out += sql[i++];
      continue;
    }
    out = (scanned.drop ? out.slice(0, -scanned.drop) : out) + scanned.text;
    i = Math.max(scanned.end, i + 1);
  }
  return out
    .replace(/\s+/g, " ")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?)")
    .replace(/\(\?\)(?:\s*,\s*\(\?\))+/g, "(?)")
    .replace(/[\s;]+$/, "")
    .trim()
    .slice(0, MAX_NORMALIZED_LENGTH);
}
