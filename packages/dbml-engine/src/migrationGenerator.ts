import type { Field, MigrationResolutionMap, Project, Ref, RefAction, Table } from "@nebuladb/shared";
import { translateType } from "@nebuladb/shared";
import { isCurrentTimeExpression } from "./migrationDiff.js";
import type { MigrationDiff, MigrationFieldChange, MigrationTableChange } from "./migrationDiff.js";

export type MigrationDialect = "postgres" | "mysql" | "sqlite" | "mssql" | "oracle" | "bigquery";

/**
 * The type actually emitted into SQL for `field` on `dialect`: the engine-
 * native translation of what was written (see `translateType`), unless the
 * user explicitly opted to keep it as-written for this column via a
 * `KEEP_AS_WRITTEN` resolution (see `TYPE_TRANSLATION_SUGGESTED` risks).
 * Translating by default — rather than only on confirmation — is deliberate:
 * a schema authored against one engine's vocabulary should deploy cleanly to
 * another out of the box, with the risk/resolution flow existing only to
 * let a user override specific columns, not gate the feature entirely.
 */
export function effectiveType(
  field: Field,
  dialect: MigrationDialect,
  tableName: string,
  resolutions: MigrationResolutionMap = {},
): string {
  const resKey = `column:${tableName.toLowerCase()}.${field.name.toLowerCase()}`;
  if (resolutions[resKey]?.strategy === "KEEP_AS_WRITTEN") return field.type || "text";
  // `decimal(18.6)` is a typo for `decimal(18,6)` that no engine accepts — repair it rather than emit invalid SQL.
  const type = (field.type || "text").replace(/\((\d+)\.(\d+)\)/, "($1,$2)");
  return translateType(type, dialect).type;
}

/**
 * The part of a schema `dialect` can hold — what is compared with a database
 * of that engine and deployed to it. BigQuery refuses a foreign key from a
 * table to itself (`user.superior_id` to `user.id`), and has neither unique
 * constraints nor indexes: left in, those would fail a deployment or show as
 * still to do in every plan.
 */
export function schemaForDialect(project: Project, dialect: MigrationDialect): Project {
  if (dialect !== "bigquery") return project;
  return {
    ...project,
    refs: project.refs.filter((ref) => ref.from.tableId !== ref.to.tableId),
    tables: project.tables.map((table) => ({
      ...table,
      fields: table.fields.map((field) => (field.unique ? { ...field, unique: false } : field)),
      // The primary key is the one "index" BigQuery knows, as a constraint of the table.
      indexes: table.indexes.filter((index) => index.pk),
    })),
  };
}

export function q(ident: string, dialect: MigrationDialect): string {
  if (dialect === "mysql" || dialect === "bigquery") return `\`${ident.replace(/`/g, "``")}\``;
  if (dialect === "mssql") return `[${ident.replace(/]/g, "]]")}]`;
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Deterministic, dependency-free string hash (FNV-1a) — this file is bundled
 * for the browser too (the web app's local DBML export), so `node:crypto`
 * isn't an option here.
 */
function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Safely under every dialect's identifier limit this generator targets (MySQL/Postgres: 63-64, Oracle 12.2+: 128) — 60 leaves room for the hash suffix below. */
const MAX_FK_NAME_LENGTH = 60;

/**
 * Fallback constraint name for an unnamed ref. Includes `toTable` — without
 * it, one column fanning out to several FKs (a PK referenced by more than one
 * child table) would generate the same name twice. Long table/field names can
 * still overflow a dialect's identifier limit, so anything past
 * `MAX_FK_NAME_LENGTH` gets truncated and given a short content hash instead
 * of silently colliding after truncation.
 */
export function fkFallbackName(fromTable: string, fromField: string, toTable: string): string {
  const full = `fk_${fromTable}_${fromField}_${toTable}`;
  if (full.length <= MAX_FK_NAME_LENGTH) return full;
  const suffix = fnv1aHex(full);
  return `${full.slice(0, MAX_FK_NAME_LENGTH - suffix.length - 1)}_${suffix}`;
}

const SQL_REF_ACTION: Record<RefAction, string> = {
  cascade: "CASCADE",
  restrict: "RESTRICT",
  "set null": "SET NULL",
  "set default": "SET DEFAULT",
  "no action": "NO ACTION",
};

/** Oracle only recognizes `ON DELETE CASCADE`/`ON DELETE SET NULL` on a FK — no `ON UPDATE` action at all, and no `RESTRICT`/`SET DEFAULT`/`NO ACTION` keyword (that's already how an Oracle FK behaves by default). */
const ORACLE_ON_DELETE: Partial<Record<RefAction, string>> = {
  cascade: "CASCADE",
  "set null": "SET NULL",
};

/**
 * `ON DELETE`/`ON UPDATE` clause for a `FOREIGN KEY` statement, empty string if
 * neither action is set. Dialect-aware because the DBML-level action vocabulary
 * (shared with Postgres/MySQL/SQL Server) isn't uniformly supported: see
 * `ORACLE_ON_DELETE` above, and T-SQL has no `RESTRICT` keyword (mapped to its
 * closest equivalent, `NO ACTION`, instead of emitting invalid SQL).
 */
export function refActionClause(ref: Ref | undefined, dialect: MigrationDialect): string {
  if (!ref) return "";
  // A BigQuery foreign key is a declaration the engine never enforces: there is nothing for it to do on delete or update.
  if (dialect === "bigquery") return "";

  if (dialect === "oracle") {
    const action = ref.onDelete && ORACLE_ON_DELETE[ref.onDelete];
    return action ? ` ON DELETE ${action}` : "";
  }

  const mapAction = (action: RefAction): string =>
    dialect === "mssql" && action === "restrict" ? "NO ACTION" : SQL_REF_ACTION[action];

  const parts: string[] = [];
  if (ref.onDelete) parts.push(`ON DELETE ${mapAction(ref.onDelete)}`);
  if (ref.onUpdate) parts.push(`ON UPDATE ${mapAction(ref.onUpdate)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function isSqlExpression(val: string): boolean {
  const v = val.trim().toLowerCase();
  return (
    v.endsWith("()") ||
    v === "current_timestamp" ||
    v === "current_date" ||
    v === "current_time" ||
    v === "null" ||
    v === "true" ||
    v === "false" ||
    v.startsWith("(") ||
    v.startsWith("'") ||
    !Number.isNaN(Number(v))
  );
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The SQL literal for `field.default`. With a `defaultKind` (anything parsed
 * from DBML) there's nothing to guess: an expression is emitted as-is, a
 * string is always quoted — even one that looks like `now()`. Without one
 * (older data, values typed in the field editor), `legacyGuess` decides, as
 * before. `null` when there is no default.
 */
export function sqlDefaultLiteral(field: Field, legacyGuess: (trimmed: string) => string): string | null {
  if (field.default === undefined || field.default === "") return null;
  const d = field.default.trim();
  switch (field.defaultKind) {
    case "expression":
    case "number":
      return d;
    case "boolean":
      return d.toLowerCase() === "null" ? "NULL" : d.toUpperCase();
    case "string":
      return quoteSqlString(field.default);
    default:
      return legacyGuess(d);
  }
}

/** The spellings of "the current date and time" each engine takes as a default, lower case. */
const NOW_NATIVE: Record<MigrationDialect, string[]> = {
  postgres: ["now()", "current_timestamp", "localtimestamp"],
  mysql: ["now()", "current_timestamp", "current_timestamp()", "localtimestamp"],
  sqlite: ["current_timestamp"],
  mssql: ["getdate()", "sysdatetime()", "current_timestamp"],
  oracle: ["current_timestamp", "localtimestamp", "sysdate", "systimestamp"],
  bigquery: [],
};

/**
 * A default written for one engine, as `dialect` takes it. Only "now" is
 * translated — `GETDATE()` deployed on PostgreSQL, `now()` on SQL Server —
 * and only where the spelling written is not valid already; anything else is
 * returned as it is. BigQuery wants the function of the column's own type.
 */
export function translateDefaultExpression(literal: string, dialect: MigrationDialect, targetType: string): string {
  const bare = literal
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
  if (!isCurrentTimeExpression(literal)) return literal;
  if (dialect === "bigquery") {
    const type = targetType.trim().toLowerCase();
    if (type.startsWith("timestamp")) return "CURRENT_TIMESTAMP()";
    if (type === "date") return "CURRENT_DATE()";
    if (type === "time") return "CURRENT_TIME()";
    return "CURRENT_DATETIME()";
  }
  if (NOW_NATIVE[dialect].includes(bare)) return literal;
  return dialect === "mssql" ? "GETDATE()" : "CURRENT_TIMESTAMP";
}

/**
 * What makes the database number an `increment` column itself — the clauses
 * the SQL export (`projectToSql`) writes, so a deployed table and an exported
 * one agree. SQLite has nothing to add: its `INTEGER PRIMARY KEY` already
 * numbers the rows. BigQuery has no such column at all.
 */
const IDENTITY_CLAUSE: Partial<Record<MigrationDialect, string>> = {
  postgres: "GENERATED BY DEFAULT AS IDENTITY",
  mysql: "AUTO_INCREMENT",
  mssql: "IDENTITY(1,1)",
  oracle: "GENERATED BY DEFAULT AS IDENTITY",
};

/**
 * `identity` is for a column of a table being created: there the `increment`
 * setting becomes the dialect's identity clause. Adding or altering a column
 * leaves it out — no engine turns an existing column into an identity with a
 * plain `ALTER`, and MySQL refuses `AUTO_INCREMENT` on a column that is no key.
 */
export function formatColumnDef(
  field: Field,
  dialect: MigrationDialect,
  typeOverride?: string,
  options: { identity?: boolean } = {},
): string {
  const type = typeOverride ?? (field.type || "text");
  const defaultOf = (legacyGuess: (trimmed: string) => string) => {
    const literal = sqlDefaultLiteral(field, legacyGuess);
    return literal === null ? null : translateDefaultExpression(literal, dialect, type);
  };
  if (dialect === "bigquery") {
    // GoogleSQL: the type, the default, then NOT NULL. Keys are table constraints (never enforced) and UNIQUE does not exist.
    const parts = [q(field.name, dialect), type];
    const literal = defaultOf((d) => (isSqlExpression(d) ? d : quoteSqlString(d)));
    if (literal !== null) parts.push(`DEFAULT ${literal}`);
    if (field.notNull || field.pk) parts.push("NOT NULL");
    return parts.join(" ");
  }
  const identity = options.identity && field.increment ? IDENTITY_CLAUSE[dialect] : undefined;
  const parts = [q(field.name, dialect), type];
  // MySQL wants AUTO_INCREMENT after the key it rests on; the others take their clause right after the type.
  if (identity && dialect !== "mysql") parts.push(identity);
  if (field.pk) parts.push("PRIMARY KEY");
  if (field.notNull && !field.pk) parts.push("NOT NULL");
  if (field.unique && !field.pk) parts.push("UNIQUE");
  // An identity column takes its value from the engine: a default on top is refused.
  const literal = identity ? null : defaultOf((d) => (isSqlExpression(d) ? d : quoteSqlString(d)));
  if (literal !== null) parts.push(`DEFAULT ${literal}`);
  if (identity && dialect === "mysql") parts.push(identity);
  return parts.join(" ");
}

export function generateCreateTable(
  table: Table,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap = {},
): string {
  const colDefs = table.fields.map(
    (f) => `  ${formatColumnDef(f, dialect, effectiveType(f, dialect, table.name, resolutions), { identity: true })}`,
  );

  // Composite PK
  const pkIndex = table.indexes.find((i) => i.pk && i.fieldIds.length > 1);
  if (pkIndex) {
    const pkCols = pkIndex.fieldIds
      .map((id) => table.fields.find((f) => f.id === id)?.name ?? id)
      .map((n) => q(n, dialect))
      .join(", ");
    colDefs.push(`  PRIMARY KEY (${pkCols})${dialect === "bigquery" ? " NOT ENFORCED" : ""}`);
  } else if (dialect === "bigquery") {
    // Elsewhere the key sits on its column; BigQuery only knows it as a constraint of the table, kept for the optimizer and never checked.
    const pkCols = table.fields.filter((f) => f.pk).map((f) => q(f.name, dialect));
    if (pkCols.length > 0) colDefs.push(`  PRIMARY KEY (${pkCols.join(", ")}) NOT ENFORCED`);
  }

  return `CREATE TABLE ${q(table.name, dialect)} (\n${colDefs.join(",\n")}\n);`;
}

export function generateDropTable(tableName: string, dialect: MigrationDialect): string {
  if (dialect === "postgres") return `DROP TABLE IF EXISTS ${q(tableName, dialect)} CASCADE;`;
  if (dialect === "oracle") return `DROP TABLE ${q(tableName, dialect)} CASCADE CONSTRAINTS;`;
  return `DROP TABLE IF EXISTS ${q(tableName, dialect)};`;
}

type Resolution = MigrationResolutionMap[string] | undefined;

/** Literal for a DEFAULT clause in an ALTER statement: quoted unless it already looks like a literal/expression. */
function alterDefaultLiteral(raw: string): string {
  const d = raw.trim();
  return d.startsWith("'") || d.startsWith("(") || !Number.isNaN(Number(d)) ? d : `'${d.replace(/'/g, "''")}'`;
}

function dropColumnStatements(table: string, col: string, dialect: MigrationDialect, resolution: Resolution): string[] {
  if (resolution?.strategy === "KEEP_IN_DB") {
    return [`-- Kept column ${q(table, dialect)}.${q(col, dialect)} per resolution choice`];
  }
  const ifExists = dialect === "postgres" || dialect === "mssql" ? "IF EXISTS " : "";
  return [`ALTER TABLE ${q(table, dialect)} DROP COLUMN ${ifExists}${q(col, dialect)};`];
}

function addColumnStatements(
  table: string,
  col: string,
  after: Field,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap,
  resolution: Resolution,
): string[] {
  if (resolution?.strategy === "KEEP_IN_DB") {
    return [`-- Skipped adding column ${q(table, dialect)}.${q(col, dialect)} per resolution choice`];
  }

  const fieldToAdd = { ...after };
  if (resolution?.value) {
    // A value typed into the resolution dialog: no DBML kind, so it's guessed like before.
    fieldToAdd.default = resolution.value;
    delete fieldToAdd.defaultKind;
  }
  const colDef = formatColumnDef(fieldToAdd, dialect, effectiveType(after, dialect, table, resolutions));
  if (dialect === "mssql") return [`ALTER TABLE ${q(table, dialect)} ADD ${colDef};`];
  if (dialect === "oracle") return [`ALTER TABLE ${q(table, dialect)} ADD (${colDef});`];
  return [`ALTER TABLE ${q(table, dialect)} ADD COLUMN ${colDef};`];
}

/** Backfill or clear data before applying alterations, per the user's resolution choice. */
function dataFixStatements(table: string, col: string, dialect: MigrationDialect, resolution: Resolution): string[] {
  const t = q(table, dialect);
  const c = q(col, dialect);
  if (resolution?.strategy === "CLEAR_COLUMN_DATA") {
    return [`UPDATE ${t} SET ${c} = NULL;`];
  }
  if (resolution?.strategy === "BACKFILL_DEFAULT" && resolution.value) {
    const val =
      resolution.value.startsWith("'") || !Number.isNaN(Number(resolution.value))
        ? resolution.value
        : `'${resolution.value.replace(/'/g, "''")}'`;
    return [`UPDATE ${t} SET ${c} = ${val} WHERE ${c} IS NULL;`];
  }
  if (resolution?.strategy === "DELETE_OFFENDING_ROWS") {
    return [`DELETE FROM ${t} WHERE ${c} IS NULL;`];
  }
  return [];
}

function typeChangeStatement(
  table: string,
  col: string,
  after: Field,
  targetType: string,
  dialect: MigrationDialect,
): string {
  const t = q(table, dialect);
  const c = q(col, dialect);
  switch (dialect) {
    case "postgres":
      return `ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${targetType} USING ${c}::${targetType};`;
    case "mysql":
      return `ALTER TABLE ${t} MODIFY COLUMN ${formatColumnDef(after, dialect, targetType)};`;
    case "mssql":
      return `ALTER TABLE ${t} ALTER COLUMN ${c} ${targetType}${after.notNull ? " NOT NULL" : ""};`;
    case "oracle":
      return `ALTER TABLE ${t} MODIFY (${c} ${targetType});`;
    case "bigquery":
      // Only widening changes are accepted (INT64 to NUMERIC, a longer STRING…); BigQuery refuses the others itself.
      return `ALTER TABLE ${t} ALTER COLUMN ${c} SET DATA TYPE ${targetType};`;
    default:
      return `-- SQLite type altered for ${t}.${c} -> ${targetType}`;
  }
}

function nullabilityChangeStatement(
  table: string,
  col: string,
  after: Field,
  targetType: string,
  dialect: MigrationDialect,
): string | undefined {
  const t = q(table, dialect);
  const c = q(col, dialect);
  if (dialect === "postgres") {
    return `ALTER TABLE ${t} ALTER COLUMN ${c} ${after.notNull ? "SET" : "DROP"} NOT NULL;`;
  }
  if (dialect === "mssql") {
    // mssql folds nullability into the same ALTER COLUMN as a type change — repeat the
    // full column def so a nullability-only change still specifies a type.
    return `ALTER TABLE ${t} ALTER COLUMN ${c} ${targetType}${after.notNull ? " NOT NULL" : " NULL"};`;
  }
  if (dialect === "oracle") {
    return `ALTER TABLE ${t} MODIFY (${c} ${after.notNull ? "NOT NULL" : "NULL"});`;
  }
  if (dialect === "bigquery") {
    return after.notNull
      ? `-- BigQuery cannot make an existing column NOT NULL: ${t}.${c} stays nullable`
      : `ALTER TABLE ${t} ALTER COLUMN ${c} DROP NOT NULL;`;
  }
  return undefined;
}

function defaultChangeStatement(
  table: string,
  col: string,
  after: Field,
  dialect: MigrationDialect,
): string | undefined {
  const t = q(table, dialect);
  const c = q(col, dialect);
  const written = sqlDefaultLiteral(after, alterDefaultLiteral);
  const literal = written === null ? null : translateDefaultExpression(written, dialect, after.type || "text");
  if (dialect === "postgres" || dialect === "bigquery") {
    return literal !== null
      ? `ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${literal};`
      : `ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT;`;
  }
  if (dialect === "oracle" && literal !== null) {
    return `ALTER TABLE ${t} MODIFY (${c} DEFAULT ${literal});`;
  }
  return undefined;
}

function modifyColumnStatements(
  table: string,
  fieldChange: MigrationFieldChange,
  after: Field,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap,
  resolution: Resolution,
): string[] {
  const col = fieldChange.name;
  const stmts = dataFixStatements(table, col, dialect, resolution);
  const targetType = effectiveType(after, dialect, table, resolutions);

  if (fieldChange.typeChanged) {
    stmts.push(typeChangeStatement(table, col, after, targetType, dialect));
  }
  if (fieldChange.notNullChanged && dialect !== "mysql" && !fieldChange.typeChanged) {
    const stmt = nullabilityChangeStatement(table, col, after, targetType, dialect);
    if (stmt) stmts.push(stmt);
  }
  if (fieldChange.defaultChanged && dialect !== "mysql") {
    const stmt = defaultChangeStatement(table, col, after, dialect);
    if (stmt) stmts.push(stmt);
  }
  return stmts;
}

function generateFieldAlterations(
  tableChange: MigrationTableChange,
  fieldChange: MigrationFieldChange,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap,
): string[] {
  const tableName = tableChange.name;
  const colName = fieldChange.name;
  const resolution = resolutions[`column:${tableName.toLowerCase()}.${colName.toLowerCase()}`];

  if (fieldChange.status === "dropped") {
    return dropColumnStatements(tableName, colName, dialect, resolution);
  }
  if (fieldChange.status === "added" && fieldChange.after) {
    return addColumnStatements(tableName, colName, fieldChange.after, dialect, resolutions, resolution);
  }
  if (fieldChange.status === "modified" && fieldChange.after) {
    return modifyColumnStatements(tableName, fieldChange, fieldChange.after, dialect, resolutions, resolution);
  }
  return [];
}

/**
 * Generates an incremental SQL migration script from a MigrationDiff, applying the user's conflict
 * strategies and wrapping the statements in a transaction.
 *
 * That wrapping is a safety net for Postgres and SQLite, whose DDL is transactional. It is **not**
 * one for MySQL: each DDL statement implicitly commits, so a failure on statement 3 of 5 has
 * already applied 1-2. The wrapping is kept there only for consistent output across dialects.
 */
export function generateMigrationSql(
  diff: MigrationDiff,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap = {},
): string {
  if (!diff.hasChanges) {
    return `-- No schema differences detected\n`;
  }

  const statements: string[] = [];

  // Transaction start
  if (dialect === "postgres") {
    statements.push("BEGIN;");
  } else if (dialect === "mysql") {
    statements.push("START TRANSACTION;");
  } else if (dialect === "sqlite" || dialect === "mssql") {
    statements.push("BEGIN TRANSACTION;");
  }
  // Oracle DDL autocommits and has no explicit transaction-start statement. BigQuery runs no DDL inside a transaction.

  // 1. Dropped Tables
  for (const table of diff.tables.filter((t) => t.status === "dropped")) {
    const resKey = `table:${table.name.toLowerCase()}`;
    if (resolutions[resKey]?.strategy === "KEEP_IN_DB") {
      statements.push(`-- Kept table ${q(table.name, dialect)} per resolution choice`);
    } else {
      statements.push(generateDropTable(table.name, dialect));
    }
  }

  // 2. Added Tables
  for (const table of diff.tables.filter((t) => t.status === "added" && t.after)) {
    statements.push(generateCreateTable(table.after!, dialect, resolutions));
  }

  // 3. Modified Tables (Columns & Indexes)
  for (const table of diff.tables.filter((t) => t.status === "modified")) {
    for (const field of table.fields) {
      const fieldStmts = generateFieldAlterations(table, field, dialect, resolutions);
      statements.push(...fieldStmts);
    }

    // Dropped Indexes
    for (const idx of table.droppedIndexes) {
      const idxName = idx.name || `idx_${table.name}_${idx.fieldIds.join("_")}`;
      // BigQuery has no secondary index to drop or create.
      if (dialect === "bigquery") continue;
      if (dialect === "mysql" || dialect === "mssql") {
        statements.push(`DROP INDEX ${q(idxName, dialect)} ON ${q(table.name, dialect)};`);
      } else if (dialect === "oracle") {
        statements.push(`DROP INDEX ${q(idxName, dialect)};`);
      } else {
        statements.push(`DROP INDEX IF EXISTS ${q(idxName, dialect)};`);
      }
    }

    // Added Indexes
    for (const idx of table.addedIndexes) {
      const targetTable = table.after!;
      const colNames = idx.fieldIds
        .map((id) => targetTable.fields.find((f) => f.id === id)?.name ?? id)
        .map((n) => q(n, dialect))
        .join(", ");
      const idxName =
        idx.name ||
        `idx_${table.name}_${idx.fieldIds.map((id) => targetTable.fields.find((f) => f.id === id)?.name ?? id).join("_")}`;
      const unique = idx.unique ? "UNIQUE " : "";
      if (dialect === "bigquery") {
        statements.push(
          `-- BigQuery has no secondary indexes: ${q(idxName, dialect)} on ${q(table.name, dialect)} is not created`,
        );
      } else if (dialect === "mssql" || dialect === "oracle") {
        // Neither supports "IF NOT EXISTS" on CREATE INDEX.
        statements.push(`CREATE ${unique}INDEX ${q(idxName, dialect)} ON ${q(table.name, dialect)} (${colNames});`);
      } else {
        statements.push(
          `CREATE ${unique}INDEX IF NOT EXISTS ${q(idxName, dialect)} ON ${q(table.name, dialect)} (${colNames});`,
        );
      }
    }
  }

  // 4. Dropped Refs (Foreign Keys) — see `fkFallbackName` for why the fallback isn't just `fk_<fromTable>_<fromField>`.
  for (const ref of diff.refs.filter((r) => r.status === "dropped")) {
    const fkName = ref.name || fkFallbackName(ref.fromTable, ref.fromField, ref.toTable);
    if (dialect === "postgres" || dialect === "mssql" || dialect === "bigquery") {
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP CONSTRAINT IF EXISTS ${q(fkName, dialect)};`);
    } else if (dialect === "mysql") {
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP FOREIGN KEY ${q(fkName, dialect)};`);
    } else if (dialect === "oracle") {
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP CONSTRAINT ${q(fkName, dialect)};`);
    }
  }

  // 5. Added Refs (Foreign Keys)
  for (const ref of diff.refs.filter((r) => r.status === "added")) {
    const fkName = ref.name || fkFallbackName(ref.fromTable, ref.fromField, ref.toTable);
    if (dialect === "bigquery" && ref.fromTable === ref.toTable) {
      // See `schemaForDialect`: a deployment never gets here with one, a hand-made diff may.
      statements.push(
        `-- BigQuery refuses a foreign key from a table to itself: ${q(ref.fromTable, dialect)}.${q(ref.fromField, dialect)} is not declared`,
      );
    } else if (dialect !== "sqlite") {
      statements.push(
        `ALTER TABLE ${q(ref.fromTable, dialect)} ADD CONSTRAINT ${q(fkName, dialect)} FOREIGN KEY (${q(ref.fromField, dialect)}) REFERENCES ${q(ref.toTable, dialect)} (${q(ref.toField, dialect)})${refActionClause(ref.after, dialect)}${dialect === "bigquery" ? " NOT ENFORCED" : ""};`,
      );
    }
  }

  // Transaction commit
  if (dialect !== "bigquery") statements.push("COMMIT;");

  return statements.join("\n\n");
}
