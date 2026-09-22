import type { DatabaseEngine } from "./schema.js";

/**
 * Cross-engine column type translation. `Field.type` is a free-text string
 * with no notion of which engine it was written for — this module maps a
 * recognized type spelling to its native equivalent on each of the five
 * supported engines, so a schema authored against one engine's vocabulary
 * (or a generic DBML type) can be deployed/exported to another without the
 * raw string surviving verbatim into invalid or missing SQL.
 *
 * Deliberately conservative: a type is only translated when it is genuinely
 * unusable on `targetEngine` (no native type of that name/meaning exists
 * there) — never merely to force one "preferred" spelling among several
 * that are all valid. `varchar(255)` deployed to SQL Server, for instance,
 * is left alone (SQL Server does accept `varchar`), even though `nvarchar`
 * is often the more idiomatic choice; that's a style opinion, not a
 * compatibility problem, and this module only fixes the latter. This also
 * keeps round-tripping a schema through the same engine byte-stable — a
 * type this table doesn't need to touch is never rewritten, not even to
 * normalize its casing.
 *
 * Unknown/unrecognized types are left untouched (`changed: false`) rather
 * than guessed at — better to pass a type through as-authored than to
 * silently mangle something this table doesn't know about.
 */

/** `"varchar(255)"` -> `{name:"varchar", args:["255"]}`; `"int"` -> `{name:"int", args:[]}`. */
export function normalizeTypeString(raw: string): { name: string; args: string[] } | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^([a-z][a-z0-9_ ]*?)\s*(?:\(([^)]*)\))?$/);
  if (!match) return null;
  const name = match[1].trim().replace(/\s+/g, " ");
  const args = match[2] ? match[2].split(",").map((a) => a.trim()) : [];
  return { name, args };
}

interface FamilyDef {
  /** Every spelling recognized as this family, across any engine — used to identify the family regardless of which engine's vocabulary a type was written in. */
  recognizedAs: string[];
  /** Spellings already valid/native on a given engine — present here means `translateType` leaves it untouched for that engine. Engines omitted (or whose list a spelling isn't in) always get translated. */
  nativeOn: Partial<Record<DatabaseEngine, string[]>>;
  /** Renders the family's canonical spelling for one engine, given the parsed args — used only when translation is actually needed. */
  render: Record<DatabaseEngine, (args: string[]) => string>;
}

function argsSuffix(args: string[], fallback?: string): string {
  if (args.length > 0) return `(${args.join(",")})`;
  return fallback ? `(${fallback})` : "";
}

const FAMILIES: Record<string, FamilyDef> = {
  int: {
    recognizedAs: ["int", "integer", "int4"],
    nativeOn: {
      postgres: ["int", "integer", "int4"],
      mysql: ["int", "integer"],
      mssql: ["int", "integer"],
      sqlite: ["int", "integer"],
    },
    render: {
      postgres: () => "integer",
      mysql: () => "int",
      mssql: () => "int",
      sqlite: () => "integer",
      oracle: () => "number(10)",
    },
  },
  bigint: {
    recognizedAs: ["bigint", "int8"],
    nativeOn: { postgres: ["bigint", "int8"], mysql: ["bigint"], mssql: ["bigint"], sqlite: ["bigint"] },
    render: {
      postgres: () => "bigint",
      mysql: () => "bigint",
      mssql: () => "bigint",
      sqlite: () => "integer",
      oracle: () => "number(19)",
    },
  },
  smallint: {
    recognizedAs: ["smallint", "int2"],
    nativeOn: { postgres: ["smallint", "int2"], mysql: ["smallint"], mssql: ["smallint"], sqlite: ["smallint"] },
    render: {
      postgres: () => "smallint",
      mysql: () => "smallint",
      mssql: () => "smallint",
      sqlite: () => "integer",
      oracle: () => "number(5)",
    },
  },
  boolean: {
    recognizedAs: ["boolean", "bool"],
    nativeOn: { postgres: ["boolean", "bool"], sqlite: ["boolean", "bool"] },
    render: {
      postgres: () => "boolean",
      mysql: () => "tinyint(1)",
      mssql: () => "bit",
      sqlite: () => "boolean",
      oracle: () => "number(1)",
    },
  },
  float: {
    recognizedAs: ["float", "real", "float4"],
    nativeOn: {
      postgres: ["float", "real", "float4"],
      mysql: ["float"],
      mssql: ["float", "real"],
      sqlite: ["float", "real"],
    },
    render: {
      postgres: () => "real",
      mysql: () => "float",
      mssql: () => "float",
      sqlite: () => "real",
      oracle: () => "binary_float",
    },
  },
  double: {
    recognizedAs: ["double", "double precision", "float8"],
    nativeOn: { postgres: ["double", "double precision", "float8"], mysql: ["double"], sqlite: ["double"] },
    render: {
      postgres: () => "double precision",
      mysql: () => "double",
      mssql: () => "float",
      sqlite: () => "real",
      oracle: () => "binary_double",
    },
  },
  decimal: {
    recognizedAs: ["decimal", "numeric"],
    nativeOn: {
      postgres: ["decimal", "numeric"],
      mysql: ["decimal", "numeric"],
      mssql: ["decimal", "numeric"],
      sqlite: ["decimal", "numeric"],
    },
    render: {
      postgres: (a) => `numeric${argsSuffix(a)}`,
      mysql: (a) => `decimal${argsSuffix(a)}`,
      mssql: (a) => `decimal${argsSuffix(a)}`,
      sqlite: () => "numeric",
      oracle: (a) => `number${argsSuffix(a)}`,
    },
  },
  varchar: {
    recognizedAs: ["varchar", "character varying", "varchar2", "nvarchar"],
    nativeOn: {
      postgres: ["varchar", "character varying"],
      mysql: ["varchar"],
      mssql: ["varchar", "nvarchar"],
      sqlite: ["varchar", "text"],
    },
    render: {
      postgres: (a) => `varchar${argsSuffix(a)}`,
      mysql: (a) => `varchar${argsSuffix(a, "255")}`,
      mssql: (a) => `varchar${argsSuffix(a, "255")}`,
      sqlite: () => "text",
      oracle: (a) => `varchar2${argsSuffix(a, "255")}`,
    },
  },
  char: {
    recognizedAs: ["char", "character", "nchar"],
    nativeOn: {
      postgres: ["char", "character"],
      mysql: ["char"],
      mssql: ["char", "nchar"],
      sqlite: ["char", "text"],
    },
    render: {
      postgres: (a) => `char${argsSuffix(a)}`,
      mysql: (a) => `char${argsSuffix(a)}`,
      mssql: (a) => `char${argsSuffix(a)}`,
      sqlite: () => "text",
      oracle: (a) => `char${argsSuffix(a)}`,
    },
  },
  text: {
    recognizedAs: ["text", "string", "clob", "ntext"],
    nativeOn: { postgres: ["text", "string"], mysql: ["text", "string"], sqlite: ["text", "string"] },
    render: {
      postgres: () => "text",
      mysql: () => "text",
      mssql: () => "nvarchar(max)",
      sqlite: () => "text",
      oracle: () => "clob",
    },
  },
  uuid: {
    recognizedAs: ["uuid", "guid", "uniqueidentifier"],
    nativeOn: { postgres: ["uuid"], mssql: ["uniqueidentifier", "guid"] },
    render: {
      postgres: () => "uuid",
      mysql: () => "char(36)",
      mssql: () => "uniqueidentifier",
      sqlite: () => "text",
      oracle: () => "raw(16)",
    },
  },
  json: {
    recognizedAs: ["json", "jsonb"],
    nativeOn: { postgres: ["json", "jsonb"], mysql: ["json"] },
    render: {
      postgres: () => "jsonb",
      mysql: () => "json",
      mssql: () => "nvarchar(max)",
      sqlite: () => "text",
      oracle: () => "clob",
    },
  },
  timestamp: {
    recognizedAs: [
      "timestamp",
      "timestamptz",
      "timestamp with time zone",
      "timestamp without time zone",
      "datetime",
      "datetime2",
    ],
    nativeOn: {
      postgres: ["timestamp", "timestamptz", "timestamp with time zone", "timestamp without time zone"],
      mysql: ["timestamp", "datetime"],
      sqlite: ["timestamp", "datetime"],
      oracle: ["timestamp"],
    },
    render: {
      postgres: () => "timestamp",
      mysql: () => "datetime",
      mssql: () => "datetime2",
      sqlite: () => "datetime",
      oracle: () => "timestamp",
    },
  },
  date: {
    recognizedAs: ["date"],
    nativeOn: {
      postgres: ["date"],
      mysql: ["date"],
      mssql: ["date"],
      sqlite: ["date"],
      oracle: ["date"],
    },
    render: {
      postgres: () => "date",
      mysql: () => "date",
      mssql: () => "date",
      sqlite: () => "date",
      oracle: () => "date",
    },
  },
  time: {
    recognizedAs: ["time"],
    nativeOn: { postgres: ["time"], mysql: ["time"], mssql: ["time"] },
    render: {
      postgres: () => "time",
      mysql: () => "time",
      mssql: () => "time",
      sqlite: () => "text",
      oracle: () => "date",
    },
  },
  binary: {
    recognizedAs: ["blob", "bytea", "binary", "varbinary", "image", "raw"],
    nativeOn: { postgres: ["bytea"], mysql: ["blob", "binary", "varbinary"], mssql: ["binary", "varbinary", "image"], sqlite: ["blob"] },
    render: {
      postgres: () => "bytea",
      mysql: () => "blob",
      mssql: () => "varbinary(max)",
      sqlite: () => "blob",
      oracle: () => "blob",
    },
  },
};

function findFamily(name: string): FamilyDef | null {
  for (const def of Object.values(FAMILIES)) {
    if (def.recognizedAs.includes(name)) return def;
  }
  return null;
}

export interface TypeTranslation {
  /** The type as originally written, unchanged. */
  original: string;
  /** The type to use for `targetEngine` — equal to `original` when nothing needed changing. */
  type: string;
  /** True when the written type wasn't valid on `targetEngine` and had to be translated to its native equivalent. */
  changed: boolean;
}

/**
 * Translates a column type string, as authored in the DBML canvas, into a
 * spelling valid on `targetEngine` — but only when the type as written
 * isn't already valid there (see the module doc for why "already valid"
 * beats "canonical/preferred"). Types this table doesn't recognize, and
 * types already native to `targetEngine`, are returned byte-for-byte
 * unchanged.
 */
export function translateType(raw: string, targetEngine: DatabaseEngine): TypeTranslation {
  const original = raw ?? "";
  const parsed = normalizeTypeString(original);
  if (!parsed) return { original, type: original, changed: false };

  const family = findFamily(parsed.name);
  if (!family) return { original, type: original, changed: false };

  if (family.nativeOn[targetEngine]?.includes(parsed.name)) {
    return { original, type: original, changed: false };
  }

  return { original, type: family.render[targetEngine](parsed.args), changed: true };
}

export const SUPPORTED_ENGINES: DatabaseEngine[] = ["postgres", "mysql", "sqlite", "mssql", "oracle"];
