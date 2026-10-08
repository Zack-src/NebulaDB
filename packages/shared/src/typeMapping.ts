import type { DatabaseEngine } from "./schema.js";

/**
 * Cross-engine column type translation: maps a recognized type spelling to its native equivalent
 * on each engine, so a schema written for one engine can be deployed or exported to another.
 *
 * Conservative: a type is translated only when unusable on `targetEngine`, never to force a
 * preferred spelling (`varchar(255)` on SQL Server is left alone). Same-engine round trips stay
 * byte-stable, and unrecognized types pass through untouched (`changed: false`).
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
      // BigQuery reads INT / INTEGER / BIGINT / SMALLINT as aliases of INT64.
      bigquery: ["int", "integer"],
    },
    render: {
      postgres: () => "integer",
      mysql: () => "int",
      mssql: () => "int",
      sqlite: () => "integer",
      oracle: () => "number(10)",
      bigquery: () => "INT64",
    },
  },
  bigint: {
    recognizedAs: ["bigint", "int8", "int64"],
    nativeOn: {
      postgres: ["bigint", "int8"],
      mysql: ["bigint"],
      mssql: ["bigint"],
      sqlite: ["bigint"],
      bigquery: ["bigint", "int64"],
    },
    render: {
      postgres: () => "bigint",
      mysql: () => "bigint",
      mssql: () => "bigint",
      sqlite: () => "integer",
      oracle: () => "number(19)",
      bigquery: () => "INT64",
    },
  },
  smallint: {
    recognizedAs: ["smallint", "int2"],
    nativeOn: {
      postgres: ["smallint", "int2"],
      mysql: ["smallint"],
      mssql: ["smallint"],
      sqlite: ["smallint"],
      bigquery: ["smallint"],
    },
    render: {
      postgres: () => "smallint",
      mysql: () => "smallint",
      mssql: () => "smallint",
      sqlite: () => "integer",
      oracle: () => "number(5)",
      bigquery: () => "INT64",
    },
  },
  boolean: {
    // `bit` is how SQL Server spells a boolean; PostgreSQL, MySQL and SQLite accept the word too.
    recognizedAs: ["boolean", "bool", "bit"],
    nativeOn: {
      postgres: ["boolean", "bool", "bit"],
      mysql: ["bit"],
      mssql: ["bit"],
      sqlite: ["boolean", "bool", "bit"],
      bigquery: ["boolean", "bool"],
    },
    render: {
      postgres: () => "boolean",
      mysql: () => "tinyint(1)",
      mssql: () => "bit",
      sqlite: () => "boolean",
      oracle: () => "number(1)",
      bigquery: () => "BOOL",
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
      bigquery: () => "FLOAT64",
    },
  },
  double: {
    recognizedAs: ["double", "double precision", "float8", "float64"],
    nativeOn: {
      postgres: ["double", "double precision", "float8"],
      mysql: ["double"],
      sqlite: ["double"],
      bigquery: ["float64"],
    },
    render: {
      postgres: () => "double precision",
      mysql: () => "double",
      mssql: () => "float",
      sqlite: () => "real",
      oracle: () => "binary_double",
      bigquery: () => "FLOAT64",
    },
  },
  decimal: {
    recognizedAs: ["decimal", "numeric", "bignumeric", "bigdecimal"],
    nativeOn: {
      postgres: ["decimal", "numeric"],
      mysql: ["decimal", "numeric"],
      mssql: ["decimal", "numeric"],
      sqlite: ["decimal", "numeric"],
      bigquery: ["decimal", "numeric", "bignumeric", "bigdecimal"],
    },
    render: {
      postgres: (a) => `numeric${argsSuffix(a)}`,
      mysql: (a) => `decimal${argsSuffix(a)}`,
      mssql: (a) => `decimal${argsSuffix(a)}`,
      sqlite: () => "numeric",
      oracle: (a) => `number${argsSuffix(a)}`,
      bigquery: (a) => `NUMERIC${argsSuffix(a)}`,
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
      bigquery: (a) => `STRING${argsSuffix(a)}`,
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
      bigquery: (a) => `STRING${argsSuffix(a)}`,
    },
  },
  text: {
    recognizedAs: ["text", "string", "clob", "ntext"],
    nativeOn: {
      postgres: ["text", "string"],
      mysql: ["text", "string"],
      sqlite: ["text", "string"],
      bigquery: ["string"],
    },
    render: {
      postgres: () => "text",
      mysql: () => "text",
      mssql: () => "nvarchar(max)",
      sqlite: () => "text",
      oracle: () => "clob",
      bigquery: () => "STRING",
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
      bigquery: () => "STRING",
    },
  },
  json: {
    recognizedAs: ["json", "jsonb"],
    nativeOn: { postgres: ["json", "jsonb"], mysql: ["json"], bigquery: ["json"] },
    render: {
      postgres: () => "jsonb",
      mysql: () => "json",
      mssql: () => "nvarchar(max)",
      sqlite: () => "text",
      oracle: () => "clob",
      bigquery: () => "JSON",
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
      // TIMESTAMP is a point in time, DATETIME a date and a time without a zone: both exist, neither is forced.
      bigquery: ["timestamp", "datetime"],
    },
    render: {
      postgres: () => "timestamp",
      mysql: () => "datetime",
      mssql: () => "datetime2",
      sqlite: () => "datetime",
      oracle: () => "timestamp",
      bigquery: () => "DATETIME",
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
      bigquery: ["date"],
    },
    render: {
      postgres: () => "date",
      mysql: () => "date",
      mssql: () => "date",
      sqlite: () => "date",
      oracle: () => "date",
      bigquery: () => "DATE",
    },
  },
  time: {
    recognizedAs: ["time"],
    nativeOn: { postgres: ["time"], mysql: ["time"], mssql: ["time"], bigquery: ["time"] },
    render: {
      postgres: () => "time",
      mysql: () => "time",
      mssql: () => "time",
      sqlite: () => "text",
      oracle: () => "date",
      bigquery: () => "TIME",
    },
  },
  binary: {
    recognizedAs: ["blob", "bytea", "binary", "varbinary", "image", "raw", "bytes"],
    nativeOn: {
      postgres: ["bytea"],
      mysql: ["blob", "binary", "varbinary"],
      mssql: ["binary", "varbinary", "image"],
      sqlite: ["blob"],
      bigquery: ["bytes"],
    },
    render: {
      postgres: () => "bytea",
      mysql: () => "blob",
      mssql: () => "varbinary(max)",
      sqlite: () => "blob",
      oracle: () => "blob",
      bigquery: () => "BYTES",
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

  // `varchar(max)` / `varbinary(max)` is SQL Server's unbounded form: elsewhere it is the engine's long text or binary type.
  if (parsed.args.includes("max") && targetEngine !== "mssql") {
    const unbounded = family === FAMILIES.binary ? FAMILIES.binary : FAMILIES.text;
    const type =
      targetEngine === "mysql"
        ? unbounded === FAMILIES.binary
          ? "longblob"
          : "longtext"
        : unbounded.render[targetEngine]([]);
    return { original, type, changed: true };
  }

  if (targetEngine === "bigquery") {
    // A zoned timestamp is BigQuery's TIMESTAMP, not the zoneless DATETIME the family renders.
    if (parsed.name === "timestamptz" || parsed.name === "timestamp with time zone") {
      return { original, type: "TIMESTAMP", changed: true };
    }
    // NUMERIC stops at 38 digits, 9 of them after the point; past that it takes BIGNUMERIC.
    if (family === FAMILIES.decimal && (Number(parsed.args[0]) > 38 || Number(parsed.args[1]) > 9)) {
      return { original, type: `BIGNUMERIC${argsSuffix(parsed.args)}`, changed: !parsed.name.startsWith("big") };
    }
  }

  if (family.nativeOn[targetEngine]?.includes(parsed.name)) {
    return { original, type: original, changed: false };
  }

  return { original, type: family.render[targetEngine](parsed.args), changed: true };
}

export const SUPPORTED_ENGINES: DatabaseEngine[] = ["postgres", "mysql", "sqlite", "mssql", "oracle", "bigquery"];

/** The families that are one thing once the engine is taken out of the picture: BigQuery has a single integer, a single float, a single text. */
const NEUTRAL_FAMILY: Record<string, string> = {
  int: "integer",
  bigint: "integer",
  smallint: "integer",
  float: "float",
  double: "float",
  varchar: "text",
  char: "text",
  text: "text",
  timestamp: "datetime",
};

/**
 * A type as no engine in particular spells it, to compare two databases of
 * different engines: `varchar(255)` on SQL Server and `STRING(255)` on
 * BigQuery are both `text(255)`, `int` and `INT64` both `integer`. Coarser
 * than any one engine on purpose — what it erases (`int` against `bigint`,
 * `datetime2` against `timestamp`) is exactly what cannot be kept from one
 * engine to another. A type it does not know is returned in lower case.
 */
export function neutralType(raw: string): string {
  const parsed = normalizeTypeString(raw ?? "");
  if (!parsed) return (raw ?? "").trim().toLowerCase();
  const name = Object.keys(FAMILIES).find((key) => FAMILIES[key].recognizedAs.includes(parsed.name));
  if (!name) return (raw ?? "").trim().toLowerCase().replace(/s+/g, "");
  const family = NEUTRAL_FAMILY[name] ?? name;
  const sized = (family === "text" || family === "decimal") && parsed.args.length > 0 && !parsed.args.includes("max");
  return sized ? `${family}(${parsed.args.join(",")})` : family;
}
