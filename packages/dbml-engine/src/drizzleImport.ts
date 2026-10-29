/* eslint-disable complexity -- tokenizer and static schema walker: branching mirrors the Drizzle API surface */
import type { RefAction } from "@nebuladb/shared";
import {
  emptyResult,
  finishImport,
  type ImportWarning,
  type IrColumn,
  type IrEnum,
  type IrForeignKey,
  type IrIndex,
  type IrTable,
  type OrmImportOptions,
  type OrmImportResult,
} from "./ormImport.js";

// ---------------------------------------------------------------------------
// Tokenizer: a small subset of TypeScript lexing. User code is never evaluated.
// ---------------------------------------------------------------------------

type Tok =
  | { t: "id"; v: string; line: number }
  | { t: "str"; v: string; line: number }
  | { t: "tpl"; v: string; line: number }
  | { t: "num"; v: string; line: number }
  | { t: "p"; v: string; line: number };

const PUNCT3 = ["...", "===", "!==", "**=", ">>>"];
const PUNCT2 = ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "<<", ">>"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let v = "";
      const start = line;
      i++;
      while (i < n && src[i] !== ch && src[i] !== "\n") {
        if (src[i] === "\\") {
          const nx = src[i + 1];
          v += nx === "n" ? "\n" : nx === "t" ? "\t" : (nx ?? "");
          i += 2;
        } else v += src[i++];
      }
      i++;
      out.push({ t: "str", v, line: start });
    } else if (ch === "`") {
      let v = "";
      const start = line;
      i++;
      let depth = 0;
      while (i < n && !(src[i] === "`" && depth === 0)) {
        if (src[i] === "\\") {
          v += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          depth++;
          v += "${";
          i += 2;
          continue;
        }
        if (src[i] === "}" && depth > 0) depth--;
        if (src[i] === "\n") line++;
        v += src[i++];
      }
      i++;
      out.push({ t: "tpl", v, line: start });
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(src[j])) {
        // stop before `.method` after an integer literal like `1.toString` (never in schemas) - keep simple
        j++;
      }
      out.push({ t: "num", v: src.slice(i, j).replace(/_/g, ""), line });
      i = j;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), line });
      i = j;
    } else {
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      const p = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : ch;
      out.push({ t: "p", v: p, line });
      i += p.length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mini expression parser. Anything beyond the shapes Drizzle schemas use
// becomes an `unknown` node (skipped to the next delimiter), never an error.
// ---------------------------------------------------------------------------

type Node =
  | { k: "id"; name: string; line: number }
  | { k: "str"; v: string; line: number }
  | { k: "num"; v: string; line: number }
  | { k: "tpl"; v: string; tag?: string; line: number }
  | { k: "obj"; props: { key?: string; value?: Node; spread?: Node }[]; line: number }
  | { k: "arr"; items: Node[]; line: number }
  | { k: "call"; callee: Node; args: Node[]; line: number }
  | { k: "member"; obj: Node; prop: string; line: number }
  | { k: "arrow"; body: Node; line: number }
  | { k: "unknown"; line: number };

class Parser {
  pos = 0;
  constructor(readonly toks: Tok[]) {}

  peek(o = 0): Tok | undefined {
    return this.toks[this.pos + o];
  }
  isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t?.t === "p" && t.v === v;
  }
  line(): number {
    return this.peek()?.line ?? this.toks[this.toks.length - 1]?.line ?? 1;
  }

  /** Skip tokens up to (not including) a delimiter at depth 0. */
  skipExpr(): void {
    let depth = 0;
    while (this.peek()) {
      const t = this.peek()!;
      if (t.t === "p") {
        if ("([{".includes(t.v)) depth++;
        else if (")]}".includes(t.v)) {
          if (depth === 0) return;
          depth--;
        } else if ((t.v === "," || t.v === ";") && depth === 0) return;
      }
      this.pos++;
    }
  }

  /** Skip a balanced `<...>` generic argument list; assumes current token is `<`. */
  skipGenerics(): void {
    let depth = 0;
    while (this.peek()) {
      const t = this.peek()!;
      if (t.t === "p") {
        if (t.v === "<") depth++;
        else if (t.v === ">") depth--;
        else if (t.v === ">>") depth -= 2;
        else if (t.v === ";" || (t.v === "{" && depth === 0)) return;
      }
      this.pos++;
      if (depth <= 0) return;
    }
  }

  parseExpr(): Node {
    const start = this.pos;
    const node = this.parsePostfix();
    // Anything left that isn't a delimiter: a binary expression, ternary, etc.
    const t = this.peek();
    if (t && !(t.t === "p" && [",", ")", "]", "}", ";"].includes(t.v))) {
      this.skipExpr();
      return { k: "unknown", line: this.toks[start]?.line ?? 0 };
    }
    return node;
  }

  parsePrimary(): Node {
    const t = this.peek();
    if (!t) return { k: "unknown", line: this.line() };
    if (t.t === "str") {
      this.pos++;
      return { k: "str", v: t.v, line: t.line };
    }
    if (t.t === "num") {
      this.pos++;
      return { k: "num", v: t.v, line: t.line };
    }
    if (t.t === "tpl") {
      this.pos++;
      return { k: "tpl", v: t.v, line: t.line };
    }
    if (t.t === "p") {
      if (t.v === "{") return this.parseObject();
      if (t.v === "[") return this.parseArray();
      if (t.v === "(") return this.parseParenOrArrow();
      if (t.v === "-" && this.peek(1)?.t === "num") {
        this.pos += 2;
        return { k: "num", v: `-${this.toks[this.pos - 1].v}`, line: t.line };
      }
      return { k: "unknown", line: t.line };
    }
    // identifier
    if (t.v === "async" && (this.isP("(", 1) || this.peek(1)?.t === "id")) {
      this.pos++;
      return this.parsePrimary();
    }
    if (t.v === "function") {
      this.pos++;
      if (this.peek()?.t === "id") this.pos++;
      if (this.isP("(")) this.skipBalanced();
      if (this.isP("{")) this.skipBalanced();
      return { k: "unknown", line: t.line };
    }
    if (t.v === "new" || t.v === "await" || t.v === "typeof") {
      this.pos++;
      return this.parsePostfix();
    }
    // `x => ...`
    if (this.isP("=>", 1)) {
      this.pos += 2;
      return { k: "arrow", body: this.parseArrowBody(), line: t.line };
    }
    this.pos++;
    // tagged template: sql`...`
    const nx = this.peek();
    if (nx?.t === "tpl") {
      this.pos++;
      return { k: "tpl", v: nx.v, tag: t.v, line: t.line };
    }
    return { k: "id", name: t.v, line: t.line };
  }

  skipBalanced(): void {
    const open = (this.peek() as Tok).v;
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    let depth = 0;
    while (this.peek()) {
      const t = this.peek()!;
      if (t.t === "p") {
        if (t.v === open) depth++;
        else if (t.v === close && --depth === 0) {
          this.pos++;
          return;
        }
      }
      this.pos++;
    }
  }

  parseArrowBody(): Node {
    if (this.isP("{")) {
      // block body: look for a top-level `return <expr>`
      const startPos = this.pos;
      let depth = 0;
      let p = this.pos;
      while (p < this.toks.length) {
        const t = this.toks[p];
        if (t.t === "p" && t.v === "{") depth++;
        else if (t.t === "p" && t.v === "}" && --depth === 0) break;
        else if (depth === 1 && t.t === "id" && t.v === "return") {
          const save = this.pos;
          this.pos = p + 1;
          const e = this.parseExpr();
          this.pos = save;
          this.pos = startPos;
          this.skipBalanced();
          return e;
        }
        p++;
      }
      this.pos = startPos;
      this.skipBalanced();
      return { k: "unknown", line: this.line() };
    }
    return this.parseExpr();
  }

  parseParenOrArrow(): Node {
    const line = this.line();
    // Find matching ')' and see if `=>` (optionally after `: type`) follows.
    let depth = 0;
    let p = this.pos;
    for (; p < this.toks.length; p++) {
      const t = this.toks[p];
      if (t.t === "p" && t.v === "(") depth++;
      else if (t.t === "p" && t.v === ")" && --depth === 0) break;
    }
    let q = p + 1;
    if (this.toks[q]?.t === "p" && this.toks[q].v === ":") {
      while (q < this.toks.length && !(this.toks[q].t === "p" && this.toks[q].v === "=>")) q++;
    }
    const isArrow = this.toks[q]?.t === "p" && this.toks[q].v === "=>";
    if (isArrow) {
      this.pos = q + 1;
      return { k: "arrow", body: this.parseArrowBody(), line };
    }
    this.pos++; // (
    const e = this.parseExpr();
    if (this.isP(")")) this.pos++;
    return e;
  }

  parseObject(): Node {
    const line = this.line();
    this.pos++; // {
    const props: { key?: string; value?: Node; spread?: Node }[] = [];
    while (this.peek() && !this.isP("}")) {
      if (this.isP(",")) {
        this.pos++;
        continue;
      }
      if (this.isP("...")) {
        this.pos++;
        props.push({ spread: this.parseExpr() });
        continue;
      }
      const kt = this.peek()!;
      let key: string | undefined;
      if (kt.t === "id" || kt.t === "str" || kt.t === "num") {
        key = kt.v;
        this.pos++;
      } else if (this.isP("[")) {
        this.skipBalanced();
      } else {
        this.pos++;
        continue;
      }
      if (this.isP(":")) {
        this.pos++;
        props.push({ key, value: this.parseExpr() });
      } else if (this.isP("(")) {
        // method shorthand
        this.skipBalanced();
        if (this.isP("{")) this.skipBalanced();
        props.push({ key, value: { k: "unknown", line: kt.line } });
      } else if (key !== undefined) {
        props.push({ key, value: { k: "id", name: key, line: kt.line } }); // shorthand
      }
    }
    if (this.isP("}")) this.pos++;
    return { k: "obj", props, line };
  }

  parseArray(): Node {
    const line = this.line();
    this.pos++; // [
    const items: Node[] = [];
    while (this.peek() && !this.isP("]")) {
      if (this.isP(",")) {
        this.pos++;
        continue;
      }
      if (this.isP("...")) {
        this.pos++;
        this.parseExpr();
        items.push({ k: "unknown", line });
        continue;
      }
      items.push(this.parseExpr());
    }
    if (this.isP("]")) this.pos++;
    return { k: "arr", items, line };
  }

  parseArgs(): Node[] {
    const args: Node[] = [];
    this.pos++; // (
    while (this.peek() && !this.isP(")")) {
      if (this.isP(",")) {
        this.pos++;
        continue;
      }
      args.push(this.parseExpr());
    }
    if (this.isP(")")) this.pos++;
    return args;
  }

  parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isP(".") || this.isP("?.")) {
        const nm = this.peek(1);
        if (nm?.t === "id") {
          this.pos += 2;
          node = { k: "member", obj: node, prop: nm.v, line: nm.line };
          continue;
        }
        break;
      }
      if (this.isP("!")) {
        this.pos++;
        continue;
      }
      if (this.isP("<") && node.k === "member") {
        // generic call: .$type<Foo>()
        const save = this.pos;
        this.skipGenerics();
        if (this.isP("(")) continue;
        this.pos = save;
        break;
      }
      if (this.isP("(")) {
        const line = this.line();
        node = { k: "call", callee: node, args: this.parseArgs(), line };
        continue;
      }
      if (this.isP("[")) {
        // element access with a string: obj["x"]
        const k = this.peek(1);
        if (k?.t === "str" && this.isP("]", 2)) {
          this.pos += 3;
          node = { k: "member", obj: node, prop: k.v, line: k.line };
          continue;
        }
        break;
      }
      if (this.peek()?.t === "id" && this.peek()!.v === "as") {
        // `as const` / `as Type` - skip the type
        this.pos++;
        while (this.peek() && !(this.peek()!.t === "p" && [",", ")", "]", "}", ";"].includes(this.peek()!.v))) {
          this.pos++;
        }
        continue;
      }
      break;
    }
    return node;
  }
}

// ---------------------------------------------------------------------------
// Semantic extraction
// ---------------------------------------------------------------------------

export type DrizzleDialect = "pg" | "mysql" | "sqlite";

export interface DrizzleImportOptions extends OrmImportOptions {
  /** Force the dialect when a file mixes none of the `pgTable`/`mysqlTable`/`sqliteTable` markers. Inferred otherwise. */
  dialect?: DrizzleDialect;
}

interface ColInfo {
  key: string;
  col: IrColumn;
  fk?: { target: Node; onDelete?: RefAction; onUpdate?: RefAction };
}

interface TableInfo {
  varName?: string;
  ir: IrTable;
  cols: Map<string, ColInfo>; // by JS key
  dialect: DrizzleDialect;
}

const ACTION_MAP: Record<string, RefAction> = {
  cascade: "cascade",
  restrict: "restrict",
  "no action": "no action",
  "set null": "set null",
  "set default": "set default",
};

function strOf(n: Node | undefined): string | undefined {
  return n?.k === "str" ? n.v : n?.k === "tpl" && !n.tag && !n.v.includes("${") ? n.v : undefined;
}
function numOf(n: Node | undefined): string | undefined {
  return n?.k === "num" ? n.v : undefined;
}
function objProp(n: Node | undefined, key: string): Node | undefined {
  if (n?.k !== "obj") return undefined;
  return n.props.find((p) => p.key === key)?.value;
}

/** Peel `a.b().c(x)` into the base call/ident plus the ordered modifier calls. */
function flattenChain(n: Node): { base: Node; mods: { name: string; args: Node[]; line: number }[] } {
  const mods: { name: string; args: Node[]; line: number }[] = [];
  let cur = n;
  while (cur.k === "call" && cur.callee.k === "member") {
    // x.y(args): modifier only if x is itself a call chain / not a bare namespace
    const inner = cur.callee.obj;
    if (inner.k === "call" || inner.k === "member") {
      mods.unshift({ name: cur.callee.prop, args: cur.args, line: cur.line });
      cur = inner;
    } else break;
  }
  return { base: cur, mods };
}

const PG_TYPES: Record<string, string> = {
  serial: "integer",
  bigserial: "bigint",
  smallserial: "smallint",
  integer: "integer",
  int: "integer",
  smallint: "smallint",
  bigint: "bigint",
  boolean: "boolean",
  text: "text",
  real: "real",
  doublePrecision: "float8",
  json: "json",
  jsonb: "jsonb",
  uuid: "uuid",
  date: "date",
  inet: "inet",
  cidr: "cidr",
  macaddr: "macaddr",
  macaddr8: "macaddr8",
  point: "point",
  line: "line",
  bytea: "bytea",
  interval: "interval",
  geometry: "geometry",
};
const PG_AUTO = new Set(["serial", "bigserial", "smallserial"]);

const MYSQL_TYPES: Record<string, string> = {
  int: "int",
  tinyint: "tinyint",
  smallint: "smallint",
  mediumint: "mediumint",
  bigint: "bigint",
  serial: "bigint",
  real: "real",
  double: "double",
  float: "float",
  text: "text",
  tinytext: "tinytext",
  mediumtext: "mediumtext",
  longtext: "longtext",
  boolean: "boolean",
  date: "date",
  json: "json",
  year: "year",
};

const SQLITE_TYPES: Record<string, string> = {
  integer: "integer",
  text: "text",
  real: "real",
  blob: "blob",
  numeric: "numeric",
  boolean: "integer",
};

/**
 * Imports Drizzle ORM table definitions (`pgTable`, `mysqlTable`,
 * `sqliteTable`, `pgSchema(...).table`, `pgEnum`) from TypeScript source by
 * static analysis: the file is tokenized and a small expression grammar is
 * parsed. Nothing is ever executed or imported.
 *
 * Supported: columns and their types, `.notNull()`, `.primaryKey()`,
 * `.default()/.defaultNow()/.defaultRandom()/.default(sql`...`)`, `.unique()`,
 * `.references(() => t.col, { onDelete, onUpdate })`, `.array()`,
 * `.generatedAlways*` (as increment for identity), table extras
 * (`primaryKey`, `index`, `uniqueIndex`, `unique`, `foreignKey`), `pgEnum`,
 * `mysqlEnum`, `pgSchema`, spreads of top-level column objects. Unsupported
 * (warned): `check()`, views, `customType`, runtime-computed names, `relations()`
 * (no database meaning, silently ignored).
 */
export function importDrizzle(source: string, options: DrizzleImportOptions = {}): OrmImportResult {
  const warnings: ImportWarning[] = [];
  const defaultName = "Drizzle schema";
  try {
    return importDrizzleUnsafe(source, options, warnings, defaultName);
  } catch (err) {
    warnings.push({ message: `Drizzle import failed: ${err instanceof Error ? err.message : String(err)}` });
    return emptyResult(options.projectName, defaultName, warnings);
  }
}

function importDrizzleUnsafe(
  source: string,
  options: DrizzleImportOptions,
  warnings: ImportWarning[],
  defaultName: string,
): OrmImportResult {
  const toks = tokenize(source);
  const parser = new Parser(toks);

  // Pass 0: collect top-level `const x = <expr>` declarations.
  const decls: { name: string; node: Node; line: number }[] = [];
  let depth = 0;
  while (parser.peek()) {
    const t = parser.peek()!;
    if (t.t === "p") {
      if (t.v === "{" || t.v === "(" || t.v === "[") depth++;
      else if (t.v === "}" || t.v === ")" || t.v === "]") depth = Math.max(0, depth - 1);
      parser.pos++;
      continue;
    }
    if (
      depth === 0 &&
      t.t === "id" &&
      (t.v === "const" || t.v === "let" || t.v === "var") &&
      parser.peek(1)?.t === "id"
    ) {
      const name = (parser.peek(1) as Tok).v;
      parser.pos += 2;
      // skip a type annotation up to `=`
      while (parser.peek() && !parser.isP("=") && !parser.isP(";")) {
        if (parser.isP("{") || parser.isP("(")) parser.skipBalanced();
        else parser.pos++;
      }
      if (parser.isP("=")) {
        parser.pos++;
        const line = parser.line();
        const node = parser.parseExpr();
        decls.push({ name, node, line });
      }
      continue;
    }
    parser.pos++;
  }

  const objectConsts = new Map<string, Node>();
  const schemaVars = new Map<string, string>(); // var -> schema name
  const enumVars = new Map<string, string>(); // var -> db enum name
  const irEnums: IrEnum[] = [];
  const tables: TableInfo[] = [];
  const tableVars = new Map<string, TableInfo>();
  const warn = (message: string, line?: number) => warnings.push({ message, line });

  const dialectOfCallee = (name: string): DrizzleDialect | undefined => {
    if (name === "pgTable" || name === "pgSchema" || name === "pgEnum" || name === "pgTableCreator") return "pg";
    if (name === "mysqlTable" || name === "mysqlSchema" || name === "mysqlEnum") return "mysql";
    if (name === "sqliteTable") return "sqlite";
    return undefined;
  };

  let dialect: DrizzleDialect | undefined = options.dialect;
  if (!dialect) {
    for (const t of toks) {
      if (t.t === "id") {
        const d = dialectOfCallee(t.v);
        if (d) {
          dialect = d;
          break;
        }
      }
    }
  }
  if (!dialect) {
    dialect = "pg";
    warn("No pgTable/mysqlTable/sqliteTable found; assuming PostgreSQL.");
  }

  // Pass 1: schemas, enums, reusable column objects.
  for (const d of decls) {
    const n = d.node;
    if (n.k === "obj") objectConsts.set(d.name, n);
    if (n.k === "call" && n.callee.k === "id") {
      if (n.callee.name === "pgSchema" || n.callee.name === "mysqlSchema") {
        const s = strOf(n.args[0]);
        if (s) schemaVars.set(d.name, s);
      } else if (n.callee.name === "pgEnum") {
        const nm = strOf(n.args[0]);
        const vals = n.args[1];
        if (nm && vals?.k === "arr") {
          enumVars.set(d.name, nm);
          irEnums.push({ name: nm, values: vals.items.map(strOf).filter((x): x is string => x !== undefined) });
        } else warn(`Enum "${d.name}" is not statically analyzable.`, d.line);
      }
    }
    if (n.k === "call" && n.callee.k === "member" && n.callee.obj.k === "id" && n.callee.prop === "enum") {
      const nm = strOf(n.args[0]);
      const vals = n.args[1];
      if (nm && vals?.k === "arr") {
        enumVars.set(d.name, nm);
        irEnums.push({ name: nm, values: vals.items.map(strOf).filter((x): x is string => x !== undefined) });
      }
    }
  }

  // Pass 2: tables.
  const resolveTableCall = (
    n: Node,
  ): { call: Extract<Node, { k: "call" }>; schema?: string; dialect: DrizzleDialect } | undefined => {
    if (n.k !== "call") return undefined;
    const c = n.callee;
    if (c.k === "id") {
      const d = dialectOfCallee(c.name);
      if (d && c.name.endsWith("Table")) return { call: n, dialect: d };
    }
    if (c.k === "member" && c.prop === "table") {
      if (c.obj.k === "id" && schemaVars.has(c.obj.name))
        return { call: n, schema: schemaVars.get(c.obj.name), dialect: dialect! };
      if (
        c.obj.k === "call" &&
        c.obj.callee.k === "id" &&
        (c.obj.callee.name === "pgSchema" || c.obj.callee.name === "mysqlSchema")
      ) {
        return { call: n, schema: strOf(c.obj.args[0]), dialect: dialect! };
      }
    }
    return undefined;
  };

  const pendingExtras: { info: TableInfo; extras: Node; paramName?: string }[] = [];

  for (const d of decls) {
    const r = resolveTableCall(d.node);
    if (!r) continue;
    const tableName = strOf(r.call.args[0]);
    if (!tableName) {
      warn(`Table "${d.name}" has a non-literal name; skipped.`, d.line);
      continue;
    }
    const info: TableInfo = {
      varName: d.name,
      dialect: r.dialect,
      cols: new Map(),
      ir: { name: tableName, schema: r.schema, columns: [], indexes: [], foreignKeys: [] },
    };
    let colsNode = r.call.args[1];
    if (colsNode?.k === "arrow") colsNode = colsNode.body;
    if (colsNode?.k !== "obj") {
      warn(`Columns of "${tableName}" are not statically analyzable.`, d.line);
    } else {
      addColumns(info, colsNode, 0);
    }
    const extras = r.call.args[2];
    if (extras) pendingExtras.push({ info, extras });
    tables.push(info);
    tableVars.set(d.name, info);
  }

  function addColumns(info: TableInfo, obj: Extract<Node, { k: "obj" }>, level: number): void {
    for (const p of obj.props) {
      if (p.spread) {
        const sp = p.spread;
        const target = sp.k === "id" ? objectConsts.get(sp.name) : undefined;
        if (target?.k === "obj" && level < 5) addColumns(info, target, level + 1);
        else
          warn(`Spread in "${info.ir.name}" columns is not statically analyzable; its columns are skipped.`, obj.line);
        continue;
      }
      if (!p.key || !p.value) continue;
      const ci = parseColumn(p.key, p.value, info);
      if (ci) {
        info.cols.set(ci.key, ci);
        info.ir.columns.push(ci.col);
      }
    }
  }

  function parseColumn(key: string, node: Node, info: TableInfo): ColInfo | undefined {
    const { base, mods } = flattenChain(node);
    if (base.k !== "call") {
      warn(`Column "${info.ir.name}.${key}" is not statically analyzable; skipped.`, node.line);
      return undefined;
    }
    let fnName: string;
    let enumFromVar: string | undefined;
    if (base.callee.k === "id") {
      fnName = base.callee.name;
      if (enumVars.has(fnName)) enumFromVar = enumVars.get(fnName);
    } else if (base.callee.k === "member") fnName = base.callee.prop;
    else {
      warn(`Column "${info.ir.name}.${key}" is not statically analyzable; skipped.`, node.line);
      return undefined;
    }
    const a0 = base.args[0];
    const cfg = a0?.k === "obj" ? a0 : base.args[1];
    const dbName = strOf(a0) ?? key;
    const d = info.dialect;
    const col: IrColumn = { name: dbName, type: "" };
    const cfgNum = (k: string) => numOf(objProp(cfg, k));

    if (enumFromVar) col.type = enumFromVar;
    else if (d === "pg") col.type = pgType(fnName, cfg, cfgNum, col, info, key, node.line);
    else if (d === "mysql") col.type = mysqlType(fnName, cfg, cfgNum, col, info, key, a0, base.args[1], node.line);
    else col.type = sqliteType(fnName, col);
    if (!col.type) col.type = fnName.toLowerCase();

    const ci: ColInfo = { key, col };
    for (const m of mods) {
      const arg = m.args[0];
      switch (m.name) {
        case "notNull":
          col.notNull = true;
          break;
        case "primaryKey":
          col.pk = true;
          if (
            d === "sqlite" &&
            objProp(arg, "autoIncrement")?.k === "id" &&
            (objProp(arg, "autoIncrement") as { name: string }).name === "true"
          ) {
            col.increment = true;
          }
          break;
        case "autoincrement":
          col.increment = true;
          break;
        case "unique":
          col.unique = true;
          break;
        case "array":
          col.type = `${col.type}[]`;
          break;
        case "default":
        case "$default":
        case "$defaultFn":
          if (m.name === "default") setDefault(col, arg);
          break;
        case "defaultNow":
          col.default = d === "sqlite" ? "CURRENT_TIMESTAMP" : "now()";
          col.defaultKind = "expression";
          break;
        case "defaultRandom":
          col.default = "gen_random_uuid()";
          col.defaultKind = "expression";
          break;
        case "generatedAlwaysAsIdentity":
        case "generatedByDefaultAsIdentity":
          col.increment = true;
          break;
        case "generatedAlwaysAs":
          col.note = [col.note, `generated always as ${arg?.k === "tpl" ? arg.v : "(expression)"}`]
            .filter(Boolean)
            .join("; ");
          break;
        case "references": {
          const refFn = arg;
          const body = refFn?.k === "arrow" ? refFn.body : undefined;
          const optNode = m.args[1];
          const od = strOf(objProp(optNode, "onDelete"));
          const ou = strOf(objProp(optNode, "onUpdate"));
          if (body) {
            ci.fk = {
              target: body,
              onDelete: od ? ACTION_MAP[od] : undefined,
              onUpdate: ou ? ACTION_MAP[ou] : undefined,
            };
          } else warn(`references() on "${info.ir.name}.${key}" is not statically analyzable.`, m.line);
          break;
        }
        case "$type":
        case "$onUpdate":
        case "$onUpdateFn":
        case "mode":
        case "length":
          break;
        default:
          break;
      }
    }
    if (col.pk) col.notNull = true;
    return ci;
  }

  function setDefault(col: IrColumn, arg: Node | undefined): void {
    if (!arg) return;
    if (arg.k === "str") {
      col.default = arg.v;
      col.defaultKind = "string";
    } else if (arg.k === "num") {
      col.default = arg.v;
      col.defaultKind = "number";
    } else if (arg.k === "id" && (arg.name === "true" || arg.name === "false")) {
      col.default = arg.name;
      col.defaultKind = "boolean";
    } else if (arg.k === "id" && arg.name === "null") {
      col.default = "null";
      col.defaultKind = "boolean";
    } else if (arg.k === "tpl") {
      col.default = arg.v.trim();
      col.defaultKind = "expression";
    } else if (arg.k === "arr" || arg.k === "obj") {
      col.default =
        arg.k === "arr" && arg.items.length === 0 ? "{}" : arg.k === "obj" && arg.props.length === 0 ? "{}" : "";
      if (col.default) col.defaultKind = "string";
      else col.default = undefined;
    }
  }

  function withLen(base: string, cfg: Node | undefined, cfgNum: (k: string) => string | undefined): string {
    const len = cfgNum("length");
    return len ? `${base}(${len})` : base;
  }

  function pgType(
    fn: string,
    cfg: Node | undefined,
    cfgNum: (k: string) => string | undefined,
    col: IrColumn,
    info: TableInfo,
    key: string,
    line: number,
  ): string {
    if (PG_AUTO.has(fn)) {
      col.increment = true;
      col.notNull = true;
    }
    if (PG_TYPES[fn]) return PG_TYPES[fn];
    switch (fn) {
      case "varchar":
      case "char":
        return withLen(fn, cfg, cfgNum);
      case "numeric":
      case "decimal": {
        const p = cfgNum("precision");
        const s = cfgNum("scale");
        return p ? `${fn}(${p}${s ? `,${s}` : ""})` : fn;
      }
      case "timestamp":
      case "time": {
        const tz = objProp(cfg, "withTimezone");
        const withTz = tz?.k === "id" && tz.name === "true";
        const prec = cfgNum("precision");
        const base = withTz ? `${fn}tz` : fn;
        return prec ? `${base}(${prec})` : base;
      }
      case "vector":
        return withLen("vector", undefined, () => cfgNum("dimensions"));
      default:
        warn(`Unknown column type ${fn}() on "${info.ir.name}.${key}"; kept as "${fn.toLowerCase()}".`, line);
        return fn.toLowerCase();
    }
  }

  function mysqlType(
    fn: string,
    cfg: Node | undefined,
    cfgNum: (k: string) => string | undefined,
    col: IrColumn,
    info: TableInfo,
    key: string,
    a0: Node | undefined,
    a1: Node | undefined,
    line: number,
  ): string {
    if (fn === "serial") {
      col.increment = true;
      col.notNull = true;
      col.unique = true;
    }
    if (MYSQL_TYPES[fn]) return MYSQL_TYPES[fn];
    switch (fn) {
      case "varchar":
      case "char":
      case "binary":
      case "varbinary":
        return withLen(fn, cfg, cfgNum);
      case "decimal": {
        const p = cfgNum("precision");
        const s = cfgNum("scale");
        return p ? `decimal(${p}${s ? `,${s}` : ""})` : "decimal";
      }
      case "datetime":
      case "timestamp":
      case "time": {
        const fsp = cfgNum("fsp");
        return fsp ? `${fn}(${fsp})` : fn;
      }
      case "mysqlEnum": {
        // mysqlEnum("status", ["a","b"]) or mysqlEnum(["a","b"])
        const list = a0?.k === "arr" ? a0 : a1;
        if (list?.k === "arr") {
          const name = `${info.ir.name}_${col.name}`;
          irEnums.push({ name, values: list.items.map(strOf).filter((x): x is string => x !== undefined) });
          return name;
        }
        warn(`mysqlEnum on "${info.ir.name}.${key}" is not statically analyzable.`, line);
        return "varchar(255)";
      }
      default:
        warn(`Unknown column type ${fn}() on "${info.ir.name}.${key}"; kept as "${fn.toLowerCase()}".`, line);
        return fn.toLowerCase();
    }
  }

  function sqliteType(fn: string, col: IrColumn): string {
    void col;
    return SQLITE_TYPES[fn] ?? fn.toLowerCase();
  }

  // Resolve a `table.col` reference node to (TableInfo, ColInfo).
  const resolveColRef = (
    n: Node,
    own?: { name: string; info: TableInfo },
  ): { info: TableInfo; col: ColInfo } | undefined => {
    if (n.k !== "member" || n.obj.k !== "id") return undefined;
    const info = own && n.obj.name === own.name ? own.info : tableVars.get(n.obj.name);
    const col = info?.cols.get(n.prop);
    return info && col ? { info, col } : undefined;
  };

  // Column-level references -> FKs (after every table exists).
  for (const info of tables) {
    for (const ci of info.cols.values()) {
      if (!ci.fk) continue;
      const target = resolveColRef(ci.fk.target, { name: info.varName ?? "", info });
      if (!target) {
        warn(`references() on "${info.ir.name}.${ci.key}" points at an unknown table/column; skipped.`);
        continue;
      }
      const fk: IrForeignKey = {
        columns: [ci.col.name],
        refTable: target.info.ir.name,
        refSchema: target.info.ir.schema,
        refColumns: [target.col.col.name],
        onDelete: ci.fk.onDelete,
        onUpdate: ci.fk.onUpdate,
      };
      info.ir.foreignKeys.push(fk);
    }
  }

  // Table extras: (t) => [ index().on(), primaryKey({columns}) ... ] or object.
  for (const { info, extras } of pendingExtras) {
    let body: Node | undefined = extras;
    if (extras.k === "arrow") body = extras.body;
    const items: Node[] =
      body?.k === "arr"
        ? body.items
        : body?.k === "obj"
          ? body.props.map((p) => p.value).filter((v): v is Node => !!v)
          : [];
    if (!body || (body.k !== "arr" && body.k !== "obj")) {
      warn(`Constraints of "${info.ir.name}" are not statically analyzable.`);
      continue;
    }
    const colName = (n: Node | undefined): string | undefined => {
      if (n?.k !== "member") return undefined;
      return info.cols.get(n.prop)?.col.name;
    };
    const colList = (n: Node | undefined): string[] => {
      const arr = n?.k === "arr" ? n.items : n ? [n] : [];
      return arr.map(colName).filter((x): x is string => x !== undefined);
    };
    for (const item of items) {
      const { base, mods } = flattenChain(item);
      if (base.k !== "call") continue;
      const fnName = base.callee.k === "id" ? base.callee.name : base.callee.k === "member" ? base.callee.prop : "";
      switch (fnName) {
        case "primaryKey": {
          const cols = colList(objProp(base.args[0], "columns"));
          const name = strOf(objProp(base.args[0], "name"));
          if (cols.length === 1) {
            const c = info.ir.columns.find((x) => x.name === cols[0]);
            if (c) {
              c.pk = true;
              c.notNull = true;
            }
          } else if (cols.length > 1) {
            const idx: IrIndex = { columns: cols, pk: true };
            if (name) idx.name = name;
            info.ir.indexes.push(idx);
            for (const c of info.ir.columns) if (cols.includes(c.name)) c.notNull = true;
          } else warn(`primaryKey() of "${info.ir.name}" has no resolvable columns.`);
          break;
        }
        case "index":
        case "uniqueIndex":
        case "unique": {
          const on = mods.find((m) => m.name === "on");
          const onCols = on ? on.args.map(colName).filter((x): x is string => x !== undefined) : [];
          const using = mods.find((m) => m.name === "using");
          const usingCols = using
            ? using.args
                .slice(1)
                .map(colName)
                .filter((x): x is string => x !== undefined)
            : [];
          const cols = onCols.length ? onCols : usingCols;
          if (!cols.length) {
            warn(`${fnName}() on "${info.ir.name}" has no resolvable columns (expression index?); skipped.`);
            break;
          }
          const idx: IrIndex = { columns: cols, unique: fnName !== "index" };
          const nm = strOf(base.args[0]);
          if (nm) idx.name = nm;
          info.ir.indexes.push(idx);
          break;
        }
        case "foreignKey": {
          const cfg = base.args[0];
          const own = colList(objProp(cfg, "columns"));
          const fcols = objProp(cfg, "foreignColumns");
          const farr = fcols?.k === "arr" ? fcols.items : [];
          const targets = farr.map((n) => resolveColRef(n));
          const ok = targets.length > 0 && targets.every((x) => x) && own.length === targets.length;
          if (!ok) {
            warn(`foreignKey() on "${info.ir.name}" is not statically analyzable; skipped.`);
            break;
          }
          const first = targets[0]!;
          const name = strOf(objProp(cfg, "name"));
          const fk: IrForeignKey = {
            columns: own,
            refTable: first.info.ir.name,
            refSchema: first.info.ir.schema,
            refColumns: targets.map((x) => x!.col.col.name),
          };
          if (name) fk.name = name;
          // onDelete/onUpdate chain: foreignKey({...}).onDelete("cascade")
          for (const m of mods) {
            const v = strOf(m.args[0]);
            if (m.name === "onDelete" && v) fk.onDelete = ACTION_MAP[v];
            if (m.name === "onUpdate" && v) fk.onUpdate = ACTION_MAP[v];
          }
          info.ir.foreignKeys.push(fk);
          break;
        }
        case "check":
          warn(`check() constraint on "${info.ir.name}" is not imported.`);
          break;
        default:
          break;
      }
    }
  }

  return finishImport({ tables: tables.map((t) => t.ir), enums: irEnums }, options.projectName, warnings, defaultName);
}
