/* eslint-disable complexity -- hand-written schema parser: one flat pass over many Prisma constructs */
import type { RefAction } from "@nebuladb/shared";
import {
  emptyResult,
  finishImport,
  type ImportWarning,
  type IrColumn,
  type IrEnum,
  type IrForeignKey,
  type IrTable,
  type OrmImportOptions,
  type OrmImportResult,
} from "./ormImport.js";

export interface PrismaImportOptions extends OrmImportOptions {
  /** Force the datasource provider (postgresql, mysql, sqlite, sqlserver, cockroachdb, mongodb) instead of reading the `datasource` block. */
  provider?: string;
}

type Provider = "postgresql" | "mysql" | "sqlite" | "sqlserver" | "cockroachdb" | "mongodb";

interface Attr {
  name: string;
  /** Raw top-level arguments; named ones keep their `name: value` form. */
  args: string[];
  line: number;
}

interface PField {
  name: string;
  typeName: string;
  optional: boolean;
  list: boolean;
  attrs: Attr[];
  line: number;
  doc?: string;
}

interface PBlock {
  kind: string;
  name: string;
  line: number;
  fields: PField[];
  /** For enums: value lines (name + attrs). */
  values: { name: string; attrs: Attr[]; doc?: string }[];
  blockAttrs: Attr[];
  props: Record<string, string>;
  doc?: string;
}

const SCALARS = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);

/** Strip a trailing `//` comment (not `///`) while respecting string literals. */
function stripLineComment(line: string): { code: string; doc?: string } {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "/" && line[i + 1] === "/") {
      const isDoc = line[i + 2] === "/";
      return { code: line.slice(0, i), doc: isDoc ? line.slice(i + 3).trim() : undefined };
    }
  }
  return { code: line };
}

/** Split `s` on top-level commas (outside (), [], {} and strings). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\") cur += s[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      cur += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse every `@attr(...)` / `@@attr(...)` in `s`. */
function parseAttrs(s: string, line: number): Attr[] {
  const attrs: Attr[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch !== "@") {
      i++;
      continue;
    }
    let j = i + 1;
    if (s[j] === "@") j++;
    const start = j;
    while (j < s.length && /[\w.]/.test(s[j])) j++;
    const name = (i + 1 < s.length && s[i + 1] === "@" ? "@" : "") + s.slice(start, j);
    let args: string[] = [];
    if (s[j] === "(") {
      let depth = 0;
      let k = j;
      let inStr = false;
      for (; k < s.length; k++) {
        const c = s[k];
        if (inStr) {
          if (c === "\\") k++;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "(") depth++;
        else if (c === ")" && --depth === 0) break;
      }
      args = splitTop(s.slice(j + 1, k));
      j = k + 1;
    }
    attrs.push({ name, args, line });
    i = j;
  }
  return attrs;
}

/** Open-minus-close parentheses outside string literals. */
function parenBalance(s: string): number {
  let bal = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "(") bal++;
    else if (ch === ")") bal--;
  }
  return bal;
}

function parseBlocks(source: string, warnings: ImportWarning[]): PBlock[] {
  const blocks: PBlock[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let cur: PBlock | null = null;
  let pendingDoc: string[] = [];
  // Block comments are rare in .prisma but legal-ish; blank them line-wise.
  let inBlockComment = false;
  let carry = "";
  for (let n = 0; n < lines.length; n++) {
    let raw = lines[n];
    if (inBlockComment) {
      const end = raw.indexOf("*/");
      if (end === -1) continue;
      raw = raw.slice(end + 2);
      inBlockComment = false;
    }
    const bc = raw.indexOf("/*");
    if (bc !== -1) {
      const end = raw.indexOf("*/", bc + 2);
      if (end === -1) {
        raw = raw.slice(0, bc);
        inBlockComment = true;
      } else raw = raw.slice(0, bc) + raw.slice(end + 2);
    }
    const { code, doc } = stripLineComment(raw);
    let text = code.trim();
    if (carry) {
      text = `${carry} ${text}`.trim();
      carry = "";
    }
    if (cur && text && parenBalance(text) > 0) {
      carry = text;
      continue;
    }
    if (!text) {
      if (doc !== undefined) pendingDoc.push(doc);
      else if (!raw.trim()) pendingDoc = [];
      continue;
    }
    if (!cur) {
      const m = /^(model|view|enum|type|datasource|generator)\s+(\w+)\s*\{\s*(.*)$/.exec(text);
      if (m) {
        cur = {
          kind: m[1],
          name: m[2],
          line: n + 1,
          fields: [],
          values: [],
          blockAttrs: [],
          props: {},
          doc: pendingDoc.length ? pendingDoc.join(" ") : undefined,
        };
        pendingDoc = [];
        const rest = m[3].trim();
        if (rest) {
          // one-line block body (`datasource db { provider = "x" }`): feed it as normal lines
          const closes = rest.endsWith("}");
          const body = closes ? rest.slice(0, -1).trim() : rest;
          lines.splice(n + 1, 0, ...(body ? [body] : []), ...(closes ? ["}"] : []));
        }
      } else {
        warnings.push({ message: `Unrecognized top-level statement: "${text.slice(0, 40)}"`, line: n + 1 });
        pendingDoc = [];
      }
      continue;
    }
    if (text !== "}" && text.endsWith("}") && !text.endsWith('"}')) {
      // closing brace sharing a line with the last member
      lines.splice(n + 1, 0, text.slice(0, -1).trim(), "}");
      continue;
    }
    if (text.startsWith("}")) {
      blocks.push(cur);
      cur = null;
      pendingDoc = [];
      continue;
    }
    const docText = pendingDoc.length ? pendingDoc.join(" ") : doc;
    pendingDoc = [];
    const line = n + 1;
    if (cur.kind === "datasource" || cur.kind === "generator") {
      const m = /^(\w+)\s*=\s*(.+)$/.exec(text);
      if (m) cur.props[m[1]] = m[2].trim();
    } else if (text.startsWith("@@")) {
      cur.blockAttrs.push(...parseAttrs(text, line));
    } else if (cur.kind === "enum") {
      const m = /^(\w+)\s*(.*)$/.exec(text);
      if (m) cur.values.push({ name: m[1], attrs: parseAttrs(m[2], line), doc: docText });
    } else {
      const m = /^(\w+)\s+([\w.]+(?:\([^)]*\))?)(\[\])?(\?)?\s*(.*)$/.exec(text);
      if (!m) {
        warnings.push({ message: `Cannot parse field line: "${text.slice(0, 50)}"`, line });
        continue;
      }
      cur.fields.push({
        name: m[1],
        typeName: m[2],
        list: Boolean(m[3]),
        optional: Boolean(m[4]),
        attrs: parseAttrs(m[5], line),
        line,
        doc: docText,
      });
    }
  }
  if (cur) {
    warnings.push({ message: `Block "${cur.name}" is not closed; using what was read.`, line: cur.line });
    blocks.push(cur);
  }
  return blocks;
}

// --- literal helpers -------------------------------------------------------

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

function namedArg(attr: Attr, name: string): string | undefined {
  for (const a of attr.args) {
    const m = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*)$`).exec(a);
    if (m) return m[1].trim();
  }
  return undefined;
}

/** First positional argument (or `name:` form). */
function positionalArg(attr: Attr, name?: string): string | undefined {
  const named = name ? namedArg(attr, name) : undefined;
  if (named !== undefined) return named;
  const first = attr.args[0];
  if (first !== undefined && !/^\w+\s*:/.test(first)) return first;
  return undefined;
}

function parseList(s: string | undefined): string[] {
  if (s === undefined) return [];
  const t = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  return splitTop(t).map((item) => item.replace(/\(.*\)$/s, "").trim());
}

const ACTIONS: Record<string, RefAction> = {
  Cascade: "cascade",
  Restrict: "restrict",
  NoAction: "no action",
  SetNull: "set null",
  SetDefault: "set default",
};

// --- type mapping ---------------------------------------------------------

const TYPE_MAP: Record<Provider, Record<string, string>> = {
  postgresql: {
    String: "text",
    Int: "integer",
    BigInt: "bigint",
    Float: "float8",
    Decimal: "decimal(65,30)",
    Boolean: "boolean",
    DateTime: "timestamp(3)",
    Json: "jsonb",
    Bytes: "bytea",
  },
  cockroachdb: {
    String: "string",
    Int: "int8",
    BigInt: "int8",
    Float: "float8",
    Decimal: "decimal(65,30)",
    Boolean: "bool",
    DateTime: "timestamp(3)",
    Json: "jsonb",
    Bytes: "bytes",
  },
  mysql: {
    String: "varchar(191)",
    Int: "int",
    BigInt: "bigint",
    Float: "double",
    Decimal: "decimal(65,30)",
    Boolean: "boolean",
    DateTime: "datetime(3)",
    Json: "json",
    Bytes: "longblob",
  },
  sqlite: {
    String: "text",
    Int: "integer",
    BigInt: "integer",
    Float: "real",
    Decimal: "decimal",
    Boolean: "boolean",
    DateTime: "datetime",
    Json: "json",
    Bytes: "blob",
  },
  sqlserver: {
    String: "nvarchar(1000)",
    Int: "int",
    BigInt: "bigint",
    Float: "float",
    Decimal: "decimal(32,16)",
    Boolean: "bit",
    DateTime: "datetime2",
    Json: "nvarchar(max)",
    Bytes: "varbinary(max)",
  },
  mongodb: {
    String: "string",
    Int: "int",
    BigInt: "long",
    Float: "double",
    Decimal: "decimal",
    Boolean: "bool",
    DateTime: "date",
    Json: "object",
    Bytes: "binData",
  },
};

const NATIVE_RENAMES: Record<string, string> = {
  doubleprecision: "float8",
  timestamptz: "timestamptz",
  timetz: "timetz",
  bytea: "bytea",
  jsonb: "jsonb",
  uuid: "uuid",
  tinyint: "tinyint",
  unsignedtinyint: "tinyint",
  unsignedsmallint: "smallint",
  unsignedmediumint: "mediumint",
  unsignedint: "int",
  unsignedbigint: "bigint",
  smallmoney: "smallmoney",
  uniqueidentifier: "uniqueidentifier",
  datetimeoffset: "datetimeoffset",
  smalldatetime: "smalldatetime",
  nvarchar: "nvarchar",
  nchar: "nchar",
  ntext: "ntext",
};

function nativeType(attrName: string, args: string[]): string {
  const base = attrName.replace(/^\w+\./, "");
  const key = base.toLowerCase();
  const name = NATIVE_RENAMES[key] ?? key;
  const a = args.map((x) => x.trim()).filter(Boolean);
  return a.length ? `${name}(${a.join(",")})` : name;
}

function normalizeProvider(p: string | undefined): Provider | undefined {
  const v = p?.toLowerCase();
  if (v === "postgres" || v === "postgresql") return "postgresql";
  if (v === "mysql" || v === "sqlite" || v === "sqlserver" || v === "cockroachdb" || v === "mongodb") return v;
  return undefined;
}

// --- main -----------------------------------------------------------------

/**
 * Imports a Prisma `schema.prisma` text. Pure text analysis, never throws: on
 * unparseable fragments it keeps what it understood and adds warnings.
 *
 * Supported: models, scalar types mapped per datasource provider (plus
 * `@db.*` native types), `@id`/`@@id`, `@unique`/`@@unique`, `@@index`,
 * `@default` (autoincrement, uuid, now, dbgenerated, literals), `@map`/`@@map`,
 * `@@schema`, enums (with `@map`), 1-1/1-n relations (`@relation(fields,
 * references, onDelete, onUpdate, map)`), implicit many-to-many (join table
 * `_AToB`), scalar lists on PostgreSQL/CockroachDB. Unsupported (warned):
 * views, composite `type` blocks, `@ignore`, `@@fulltext`, `Unsupported()`
 * (kept as the raw type), scalar lists on other providers (stored as json).
 */
export function importPrisma(source: string, options: PrismaImportOptions = {}): OrmImportResult {
  const warnings: ImportWarning[] = [];
  const defaultName = "Prisma schema";
  try {
    return importPrismaUnsafe(source, options, warnings, defaultName);
  } catch (err) {
    warnings.push({ message: `Prisma import failed: ${err instanceof Error ? err.message : String(err)}` });
    return emptyResult(options.projectName, defaultName, warnings);
  }
}

function importPrismaUnsafe(
  source: string,
  options: PrismaImportOptions,
  warnings: ImportWarning[],
  defaultName: string,
): OrmImportResult {
  const blocks = parseBlocks(source, warnings);

  const ds = blocks.find((b) => b.kind === "datasource");
  let provider = normalizeProvider(options.provider) ?? normalizeProvider(unquote(ds?.props.provider ?? ""));
  if (!provider) {
    warnings.push({
      message: ds ? "Unknown datasource provider; assuming postgresql." : "No datasource block; assuming postgresql.",
    });
    provider = "postgresql";
  }
  if (provider === "mongodb") warnings.push({ message: "MongoDB schemas are approximated as relational tables." });
  const typeMap = TYPE_MAP[provider];
  const pgLike = provider === "postgresql" || provider === "cockroachdb";

  const models = blocks.filter((b) => b.kind === "model");
  for (const b of blocks) {
    if (b.kind === "view") warnings.push({ message: `View "${b.name}" is not imported.`, line: b.line });
    else if (b.kind === "type")
      warnings.push({ message: `Composite type "${b.name}" is not imported.`, line: b.line });
  }

  const enumDefs = blocks.filter((b) => b.kind === "enum");
  const enumNames = new Set(enumDefs.map((e) => e.name));
  const enumDbName = new Map<string, string>();
  const irEnums: IrEnum[] = enumDefs.map((e) => {
    const mapAttr = e.blockAttrs.find((a) => a.name === "@map");
    const dbName = mapAttr?.args[0] ? unquote(mapAttr.args[0]) : e.name;
    enumDbName.set(e.name, dbName);
    return {
      name: dbName,
      values: e.values.map((v) => {
        const m = v.attrs.find((a) => a.name === "map");
        return m?.args[0] ? unquote(m.args[0]) : v.name;
      }),
    };
  });
  // Enum value default lookup: prisma value name -> db value
  const enumValueDb = new Map<string, Map<string, string>>();
  for (const e of enumDefs) {
    const m = new Map<string, string>();
    for (const v of e.values) {
      const a = v.attrs.find((x) => x.name === "map");
      m.set(v.name, a?.args[0] ? unquote(a.args[0]) : v.name);
    }
    enumValueDb.set(e.name, m);
  }

  const modelByName = new Map(models.map((m) => [m.name, m]));
  const ignored = new Set(models.filter((m) => m.blockAttrs.some((a) => a.name === "@ignore")).map((m) => m.name));
  for (const name of ignored) warnings.push({ message: `Model "${name}" has @@ignore and is skipped.` });

  const tableNameOf = (m: PBlock) => {
    const a = m.blockAttrs.find((x) => x.name === "@map");
    return a?.args[0] ? unquote(a.args[0]) : m.name;
  };
  const schemaOf = (m: PBlock) => {
    const a = m.blockAttrs.find((x) => x.name === "@schema");
    return a?.args[0] ? unquote(a.args[0]) : undefined;
  };

  const isRelationField = (f: PField) => modelByName.has(f.typeName);
  const colNameOf = (f: PField) => {
    const a = f.attrs.find((x) => x.name === "map");
    return a?.args[0] ? unquote(positionalArg(a, "name") ?? a.args[0]) : f.name;
  };
  /** prisma field name -> db column name, per model */
  const colMap = new Map<string, Map<string, string>>();
  for (const m of models) {
    const cm = new Map<string, string>();
    for (const f of m.fields) if (!isRelationField(f)) cm.set(f.name, colNameOf(f));
    colMap.set(m.name, cm);
  }
  const col = (model: string, field: string) => colMap.get(model)?.get(field) ?? field;

  const irTables: IrTable[] = [];
  const irByModel = new Map<string, IrTable>();

  for (const m of models) {
    if (ignored.has(m.name)) continue;
    const t: IrTable = {
      name: tableNameOf(m),
      schema: schemaOf(m),
      note: m.doc,
      columns: [],
      indexes: [],
      foreignKeys: [],
    };
    for (const f of m.fields) {
      if (isRelationField(f)) continue;
      if (f.attrs.some((a) => a.name === "ignore")) {
        warnings.push({ message: `Field "${m.name}.${f.name}" has @ignore and is skipped.`, line: f.line });
        continue;
      }
      const c = mapField(f, m);
      if (c) t.columns.push(c);
    }
    for (const a of m.blockAttrs) blockAttr(a, m, t);
    irTables.push(t);
    irByModel.set(m.name, t);
  }

  function mapField(f: PField, m: PBlock): IrColumn | undefined {
    let type: string;
    const unsupported = /^Unsupported\((.*)\)$/.exec(f.typeName);
    const warnAt = (message: string) => warnings.push({ message, line: f.line });
    if (unsupported) {
      type = unquote(unsupported[1]);
      warnAt(`"${m.name}.${f.name}" uses Unsupported("${type}"); kept as a raw type.`);
    } else if (SCALARS.has(f.typeName)) {
      type = typeMap[f.typeName];
      const native = f.attrs.find((a) => a.name.startsWith("db."));
      if (native) type = nativeType(native.name, native.args);
    } else if (enumNames.has(f.typeName)) {
      type = enumDbName.get(f.typeName) ?? f.typeName;
    } else {
      warnAt(`Unknown type "${f.typeName}" on "${m.name}.${f.name}"; kept as-is.`);
      type = f.typeName;
    }
    if (f.list) {
      if (pgLike) type = `${type}[]`;
      else {
        warnAt(`Scalar list "${m.name}.${f.name}" is not supported by ${provider}; stored as json.`);
        type = "json";
      }
    }
    const c: IrColumn = { name: colNameOf(f), type, notNull: !f.optional && !f.list };
    if (f.doc) c.note = f.doc;
    for (const a of f.attrs) {
      if (a.name === "id") c.pk = true;
      else if (a.name === "unique") {
        // `@unique(map: "x")` / `@unique(sort: Desc)` are all single-column uniques.
        c.unique = true;
      } else if (a.name === "default") applyDefault(a, f, c);
      else if (a.name === "updatedAt") c.note = [c.note, "@updatedAt (maintained by Prisma Client)"].filter(Boolean).join(" ");
    }
    return c;
  }

  function applyDefault(a: Attr, f: PField, c: IrColumn): void {
    const raw = (a.args[0] ?? "").trim();
    if (!raw) return;
    // Named `map:` argument aside, the first positional is the value.
    const val = positionalArg(a, "") ?? raw;
    const warnAt = (message: string) => warnings.push({ message, line: a.line });
    const fn = /^(\w+)\((.*)\)$/s.exec(val);
    if (fn) {
      switch (fn[1]) {
        case "autoincrement":
          c.increment = true;
          return;
        case "now":
          c.default = provider === "sqlite" ? "CURRENT_TIMESTAMP" : provider === "sqlserver" ? "getdate()" : "now()";
          c.defaultKind = "expression";
          return;
        case "uuid":
          if (pgLike) {
            c.default = "gen_random_uuid()";
            c.defaultKind = "expression";
          } else if (provider === "mysql") {
            c.default = "(uuid())";
            c.defaultKind = "expression";
          } else if (provider === "sqlserver") {
            c.default = "newid()";
            c.defaultKind = "expression";
          } else c.note = [c.note, "@default(uuid()) generated by Prisma Client"].filter(Boolean).join(" ");
          return;
        case "cuid":
        case "nanoid":
        case "ulid":
          c.note = [c.note, `@default(${fn[1]}()) generated by Prisma Client`].filter(Boolean).join(" ");
          return;
        case "dbgenerated": {
          const expr = fn[2].trim() ? unquote(fn[2]) : "";
          if (expr) {
            c.default = expr;
            c.defaultKind = "expression";
          }
          return;
        }
        case "sequence":
          c.increment = true;
          return;
        case "auto":
          return;
        default:
          warnAt(`Unsupported default function ${fn[1]}() on "${f.name}"; ignored.`);
          return;
      }
    }
    if (val.startsWith('"')) {
      c.default = unquote(val);
      c.defaultKind = "string";
    } else if (/^-?\d+(\.\d+)?$/.test(val)) {
      c.default = val;
      c.defaultKind = "number";
    } else if (val === "true" || val === "false") {
      c.default = val;
      c.defaultKind = "boolean";
    } else if (val.startsWith("[")) {
      warnAt(`List default on "${f.name}" is not representable; ignored.`);
    } else if (enumNames.has(f.typeName)) {
      c.default = enumValueDb.get(f.typeName)?.get(val) ?? val;
      c.defaultKind = "string";
    } else {
      c.default = val;
      c.defaultKind = "expression";
    }
  }

  function blockAttr(a: Attr, m: PBlock, t: IrTable): void {
    const toCols = (list: string[]) => list.map((n) => col(m.name, n));
    switch (a.name) {
      case "@id": {
        const cols = toCols(parseList(positionalArg(a, "fields")));
        if (cols.length === 1) {
          const c = t.columns.find((x) => x.name === cols[0]);
          if (c) c.pk = true;
        } else if (cols.length > 1) {
          t.indexes.push({ columns: cols, pk: true, name: nameOf(a) });
        }
        break;
      }
      case "@unique": {
        const cols = toCols(parseList(positionalArg(a, "fields")));
        if (cols.length) t.indexes.push({ columns: cols, unique: true, name: nameOf(a) });
        break;
      }
      case "@index": {
        const cols = toCols(parseList(positionalArg(a, "fields")));
        if (cols.length) t.indexes.push({ columns: cols, name: nameOf(a) });
        break;
      }
      case "@map":
      case "@schema":
      case "@ignore":
        break;
      case "@fulltext":
        warnings.push({ message: `@@fulltext on "${m.name}" is not imported.`, line: a.line });
        break;
      default:
        warnings.push({ message: `Unsupported block attribute @${a.name} on "${m.name}".`, line: a.line });
    }
  }

  function nameOf(a: Attr): string | undefined {
    const v = namedArg(a, "map") ?? namedArg(a, "name");
    return v ? unquote(v) : undefined;
  }

  // Relations ---------------------------------------------------------------
  for (const m of models) {
    const t = irByModel.get(m.name);
    if (!t) continue;
    for (const f of m.fields) {
      if (!isRelationField(f) || f.list) continue;
      const rel = f.attrs.find((a) => a.name === "relation");
      const fieldsArg = rel ? (namedArg(rel, "fields") ?? undefined) : undefined;
      if (!rel || fieldsArg === undefined) continue; // back-relation side
      const target = modelByName.get(f.typeName)!;
      const tt = irByModel.get(target.name);
      if (!tt) {
        warnings.push({ message: `Relation "${m.name}.${f.name}" targets ignored model "${target.name}".`, line: f.line });
        continue;
      }
      const fkCols = parseList(fieldsArg).map((n) => col(m.name, n));
      const refFields = parseList(namedArg(rel, "references"));
      if (fkCols.length === 0 || fkCols.length !== refFields.length) {
        warnings.push({
          message: `Relation "${m.name}.${f.name}" needs matching fields/references lists; skipped.`,
          line: f.line,
        });
        continue;
      }
      const fk: IrForeignKey = {
        columns: fkCols,
        refTable: tt.name,
        refSchema: tt.schema,
        refColumns: refFields.map((n) => col(target.name, n)),
      };
      const od = namedArg(rel, "onDelete");
      const ou = namedArg(rel, "onUpdate");
      if (od) fk.onDelete = ACTIONS[od] ?? undefined;
      if (ou) fk.onUpdate = ACTIONS[ou] ?? undefined;
      const mapName = namedArg(rel, "map");
      if (mapName) fk.name = unquote(mapName);
      t.foreignKeys.push(fk);
    }
  }

  // Implicit many-to-many ------------------------------------------------------
  const relName = (f: PField) => {
    const rel = f.attrs.find((a) => a.name === "relation");
    if (!rel) return "";
    const n = namedArg(rel, "name") ?? (rel.args[0] && !/^\w+\s*:/.test(rel.args[0]) ? rel.args[0] : undefined);
    return n ? unquote(n) : "";
  };
  const done = new Set<PField>();
  for (const a of models) {
    for (const f of a.fields) {
      if (!f.list || !isRelationField(f) || done.has(f)) continue;
      const rel = f.attrs.find((x) => x.name === "relation");
      if (rel && namedArg(rel, "fields") !== undefined) continue;
      const b = modelByName.get(f.typeName)!;
      const opposite = b.fields.find(
        (g) =>
          g !== f &&
          g.typeName === a.name &&
          relName(g) === relName(f) &&
          (a !== b || !done.has(g)),
      );
      if (!opposite) {
        warnings.push({ message: `Relation field "${a.name}.${f.name}" has no opposite side; ignored.`, line: f.line });
        continue;
      }
      if (!opposite.list) continue; // plain 1-n back-relation
      done.add(f);
      done.add(opposite);
      if (ignored.has(a.name) || ignored.has(b.name)) continue;
      const [first, second] = [a, b].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      const joinName = relName(f) ? `_${relName(f)}` : `_${first.name}To${second.name}`;
      const ta = irByModel.get(first.name)!;
      const tb = irByModel.get(second.name)!;
      const pkOf = (model: PBlock, t: IrTable): IrColumn | undefined => {
        const pks = t.columns.filter((c) => c.pk);
        if (pks.length === 1) return pks[0];
        const unique = model.fields.find((x) => x.attrs.some((y) => y.name === "unique") && !isRelationField(x));
        return unique ? t.columns.find((c) => c.name === colNameOf(unique)) : undefined;
      };
      const pa = pkOf(first, ta);
      const pb = pkOf(second, tb);
      if (!pa || !pb) {
        warnings.push({
          message: `Many-to-many ${a.name}.${f.name} <-> ${b.name}.${opposite.name}: a model has no single-column id; join table not created.`,
          line: f.line,
        });
        continue;
      }
      const baseType = (c: IrColumn) => c.type;
      irTables.push({
        name: joinName,
        schema: ta.schema,
        columns: [
          { name: "A", type: baseType(pa), notNull: true },
          { name: "B", type: baseType(pb), notNull: true },
        ],
        indexes: [
          { columns: ["A", "B"], unique: true, name: `${joinName}_AB_unique` },
          { columns: ["B"], name: `${joinName}_B_index` },
        ],
        foreignKeys: [
          { columns: ["A"], refTable: ta.name, refSchema: ta.schema, refColumns: [pa.name], onDelete: "cascade", onUpdate: "cascade" },
          { columns: ["B"], refTable: tb.name, refSchema: tb.schema, refColumns: [pb.name], onDelete: "cascade", onUpdate: "cascade" },
        ],
      });
    }
  }

  return finishImport({ tables: irTables, enums: irEnums }, options.projectName, warnings, defaultName);
}
