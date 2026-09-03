import type { Field, MigrationResolutionMap, Ref, RefAction, Table } from "@athanordb/shared";
import { translateType } from "@athanordb/shared";
import type { MigrationDiff, MigrationFieldChange, MigrationTableChange } from "./migrationDiff.js";

export type MigrationDialect = "postgres" | "mysql" | "sqlite" | "mssql" | "oracle";

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
  return translateType(field.type || "text", dialect).type;
}

export function q(ident: string, dialect: MigrationDialect): string {
  if (dialect === "mysql") return `\`${ident.replace(/`/g, "``")}\``;
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

export function formatColumnDef(field: Field, dialect: MigrationDialect, typeOverride?: string): string {
  const parts = [q(field.name, dialect), typeOverride ?? (field.type || "text")];
  if (field.pk) parts.push("PRIMARY KEY");
  if (field.notNull && !field.pk) parts.push("NOT NULL");
  if (field.unique && !field.pk) parts.push("UNIQUE");
  if (field.default !== undefined && field.default !== "") {
    const d = field.default.trim();
    if (isSqlExpression(d)) {
      parts.push(`DEFAULT ${d}`);
    } else {
      parts.push(`DEFAULT '${d.replace(/'/g, "''")}'`);
    }
  }
  return parts.join(" ");
}

export function generateCreateTable(
  table: Table,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap = {},
): string {
  const colDefs = table.fields.map(
    (f) => `  ${formatColumnDef(f, dialect, effectiveType(f, dialect, table.name, resolutions))}`,
  );

  // Composite PK
  const pkIndex = table.indexes.find((i) => i.pk && i.fieldIds.length > 1);
  if (pkIndex) {
    const pkCols = pkIndex.fieldIds
      .map((id) => table.fields.find((f) => f.id === id)?.name ?? id)
      .map((n) => q(n, dialect))
      .join(", ");
    colDefs.push(`  PRIMARY KEY (${pkCols})`);
  }

  return `CREATE TABLE ${q(table.name, dialect)} (\n${colDefs.join(",\n")}\n);`;
}

export function generateDropTable(tableName: string, dialect: MigrationDialect): string {
  if (dialect === "postgres") return `DROP TABLE IF EXISTS ${q(tableName, dialect)} CASCADE;`;
  if (dialect === "oracle") return `DROP TABLE ${q(tableName, dialect)} CASCADE CONSTRAINTS;`;
  return `DROP TABLE IF EXISTS ${q(tableName, dialect)};`;
}

function generateFieldAlterations(
  tableChange: MigrationTableChange,
  fieldChange: MigrationFieldChange,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap,
): string[] {
  const tableName = tableChange.name;
  const colName = fieldChange.name;
  const resKey = `column:${tableName.toLowerCase()}.${colName.toLowerCase()}`;
  const resolution = resolutions[resKey];
  const stmts: string[] = [];

  if (fieldChange.status === "dropped") {
    if (resolution?.strategy === "KEEP_IN_DB") {
      return [`-- Kept column ${q(tableName, dialect)}.${q(colName, dialect)} per resolution choice`];
    }
    if (dialect === "postgres" || dialect === "mssql") {
      stmts.push(`ALTER TABLE ${q(tableName, dialect)} DROP COLUMN IF EXISTS ${q(colName, dialect)};`);
    } else {
      stmts.push(`ALTER TABLE ${q(tableName, dialect)} DROP COLUMN ${q(colName, dialect)};`);
    }
    return stmts;
  }

  if (fieldChange.status === "added" && fieldChange.after) {
    const after = fieldChange.after;
    if (resolution?.strategy === "KEEP_IN_DB") {
      return [`-- Skipped adding column ${q(tableName, dialect)}.${q(colName, dialect)} per resolution choice`];
    }

    const fieldToAdd = { ...after };
    if (resolution?.value) {
      fieldToAdd.default = resolution.value;
    }
    const addType = effectiveType(after, dialect, tableName, resolutions);
    if (dialect === "mssql") {
      stmts.push(`ALTER TABLE ${q(tableName, dialect)} ADD ${formatColumnDef(fieldToAdd, dialect, addType)};`);
    } else if (dialect === "oracle") {
      stmts.push(`ALTER TABLE ${q(tableName, dialect)} ADD (${formatColumnDef(fieldToAdd, dialect, addType)});`);
    } else {
      stmts.push(`ALTER TABLE ${q(tableName, dialect)} ADD COLUMN ${formatColumnDef(fieldToAdd, dialect, addType)};`);
    }
    return stmts;
  }

  if (fieldChange.status === "modified" && fieldChange.after) {
    const after = fieldChange.after;

    // Handle backfill or clear data before applying alterations
    if (resolution?.strategy === "CLEAR_COLUMN_DATA") {
      stmts.push(`UPDATE ${q(tableName, dialect)} SET ${q(colName, dialect)} = NULL;`);
    } else if (resolution?.strategy === "BACKFILL_DEFAULT" && resolution.value) {
      const val =
        resolution.value.startsWith("'") || !Number.isNaN(Number(resolution.value))
          ? resolution.value
          : `'${resolution.value.replace(/'/g, "''")}'`;
      stmts.push(
        `UPDATE ${q(tableName, dialect)} SET ${q(colName, dialect)} = ${val} WHERE ${q(colName, dialect)} IS NULL;`,
      );
    } else if (resolution?.strategy === "DELETE_OFFENDING_ROWS") {
      stmts.push(`DELETE FROM ${q(tableName, dialect)} WHERE ${q(colName, dialect)} IS NULL;`);
    }

    const targetType = effectiveType(after, dialect, tableName, resolutions);

    // Type change
    if (fieldChange.typeChanged) {
      if (dialect === "postgres") {
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} TYPE ${targetType} USING ${q(colName, dialect)}::${targetType};`,
        );
      } else if (dialect === "mysql") {
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} MODIFY COLUMN ${formatColumnDef(after, dialect, targetType)};`);
      } else if (dialect === "mssql") {
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} ${targetType}${after.notNull ? " NOT NULL" : ""};`,
        );
      } else if (dialect === "oracle") {
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} MODIFY (${q(colName, dialect)} ${targetType});`);
      } else {
        stmts.push(`-- SQLite type altered for ${q(tableName, dialect)}.${q(colName, dialect)} -> ${targetType}`);
      }
    }

    // Nullability change
    if (fieldChange.notNullChanged && dialect !== "mysql" && !fieldChange.typeChanged) {
      if (dialect === "postgres") {
        if (after.notNull) {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET NOT NULL;`);
        } else {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP NOT NULL;`);
        }
      } else if (dialect === "mssql") {
        // mssql folds nullability into the same ALTER COLUMN as a type change — repeat the
        // full column def so a nullability-only change still specifies a type.
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} ${targetType}${after.notNull ? " NOT NULL" : " NULL"};`,
        );
      } else if (dialect === "oracle") {
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} MODIFY (${q(colName, dialect)} ${after.notNull ? "NOT NULL" : "NULL"});`,
        );
      }
    }

    // Default change
    if (fieldChange.defaultChanged && dialect !== "mysql") {
      if (dialect === "postgres") {
        if (after.default !== undefined && after.default !== "") {
          const d = after.default.trim();
          const defVal =
            d.startsWith("'") || d.startsWith("(") || !Number.isNaN(Number(d)) ? d : `'${d.replace(/'/g, "''")}'`;
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET DEFAULT ${defVal};`);
        } else {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP DEFAULT;`);
        }
      } else if (dialect === "oracle" && after.default !== undefined && after.default !== "") {
        const d = after.default.trim();
        const defVal =
          d.startsWith("'") || d.startsWith("(") || !Number.isNaN(Number(d)) ? d : `'${d.replace(/'/g, "''")}'`;
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} MODIFY (${q(colName, dialect)} DEFAULT ${defVal});`);
      }
    }
  }

  return stmts;
}

/**
 * Generates an incremental SQL migration script from a MigrationDiff, applying
 * user conflict resolution strategies and wrapping the statements in a transaction.
 *
 * That wrapping is a genuine safety net for Postgres and SQLite, whose DDL
 * participates in a transaction like any other statement — a failure
 * partway through leaves nothing applied once the driver rolls back. It is
 * **not** one for MySQL: every DDL statement there causes an implicit commit
 * regardless of `START TRANSACTION`/`COMMIT` wrapping it, so a MySQL
 * migration that fails on statement 3 of 5 has already permanently applied
 * statements 1–2, with no automatic way back. This is an engine limitation,
 * not something this function (or the driver calling it) can fix by
 * generating different SQL — the wrapping is kept for MySQL anyway because a
 * `START TRANSACTION`/`COMMIT` pair is at least harmless there and keeps the
 * three dialects' output shape consistent, but nothing should read its
 * presence as a MySQL atomicity guarantee.
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
  // Oracle DDL autocommits and has no explicit transaction-start statement.

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
      if (dialect === "mssql" || dialect === "oracle") {
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
    if (dialect === "postgres" || dialect === "mssql") {
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
    if (dialect !== "sqlite") {
      statements.push(
        `ALTER TABLE ${q(ref.fromTable, dialect)} ADD CONSTRAINT ${q(fkName, dialect)} FOREIGN KEY (${q(ref.fromField, dialect)}) REFERENCES ${q(ref.toTable, dialect)} (${q(ref.toField, dialect)})${refActionClause(ref.after, dialect)};`,
      );
    }
  }

  // Transaction commit
  statements.push("COMMIT;");

  return statements.join("\n\n");
}
