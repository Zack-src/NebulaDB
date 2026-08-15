import type { Field, MigrationResolutionMap, Table } from "@athanordb/shared";
import type { MigrationDiff, MigrationFieldChange, MigrationTableChange } from "./migrationDiff.js";

export type MigrationDialect = "postgres" | "mysql" | "sqlite";

function q(ident: string, dialect: MigrationDialect): string {
  if (dialect === "mysql") return `\`${ident.replace(/`/g, "``")}\``;
  return `"${ident.replace(/"/g, '""')}"`;
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

function formatColumnDef(field: Field, dialect: MigrationDialect): string {
  const parts = [q(field.name, dialect), field.type || "text"];
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


function generateCreateTable(table: Table, dialect: MigrationDialect): string {
  const colDefs = table.fields.map((f) => `  ${formatColumnDef(f, dialect)}`);
  
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

function generateDropTable(tableName: string, dialect: MigrationDialect): string {
  if (dialect === "postgres") return `DROP TABLE IF EXISTS ${q(tableName, dialect)} CASCADE;`;
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
    if (dialect === "postgres") {
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
    stmts.push(`ALTER TABLE ${q(tableName, dialect)} ADD COLUMN ${formatColumnDef(fieldToAdd, dialect)};`);
    return stmts;
  }

  if (fieldChange.status === "modified" && fieldChange.after) {
    const after = fieldChange.after;

    // Handle backfill or clear data before applying alterations
    if (resolution?.strategy === "CLEAR_COLUMN_DATA") {
      stmts.push(`UPDATE ${q(tableName, dialect)} SET ${q(colName, dialect)} = NULL;`);
    } else if (resolution?.strategy === "BACKFILL_DEFAULT" && resolution.value) {
      const val = resolution.value.startsWith("'") || !Number.isNaN(Number(resolution.value)) ? resolution.value : `'${resolution.value.replace(/'/g, "''")}'`;
      stmts.push(`UPDATE ${q(tableName, dialect)} SET ${q(colName, dialect)} = ${val} WHERE ${q(colName, dialect)} IS NULL;`);
    } else if (resolution?.strategy === "DELETE_OFFENDING_ROWS") {
      stmts.push(`DELETE FROM ${q(tableName, dialect)} WHERE ${q(colName, dialect)} IS NULL;`);
    }

    // Type change
    if (fieldChange.typeChanged) {
      if (dialect === "postgres") {
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} TYPE ${after.type} USING ${q(colName, dialect)}::${after.type};`,
        );
      } else if (dialect === "mysql") {
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} MODIFY COLUMN ${formatColumnDef(after, dialect)};`);
      } else {
        stmts.push(`-- SQLite type altered for ${q(tableName, dialect)}.${q(colName, dialect)} -> ${after.type}`);
      }
    }

    // Nullability change
    if (fieldChange.notNullChanged && dialect !== "mysql") {
      if (dialect === "postgres") {
        if (after.notNull) {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET NOT NULL;`);
        } else {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP NOT NULL;`);
        }
      }
    }

    // Default change
    if (fieldChange.defaultChanged && dialect !== "mysql") {
      if (dialect === "postgres") {
        if (after.default !== undefined && after.default !== "") {
          const d = after.default.trim();
          const defVal = d.startsWith("'") || d.startsWith("(") || !Number.isNaN(Number(d)) ? d : `'${d.replace(/'/g, "''")}'`;
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET DEFAULT ${defVal};`);
        } else {
          stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP DEFAULT;`);
        }
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
  } else if (dialect === "sqlite") {
    statements.push("BEGIN TRANSACTION;");
  }

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
    statements.push(generateCreateTable(table.after!, dialect));
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
      if (dialect === "mysql") {
        statements.push(`DROP INDEX ${q(idxName, dialect)} ON ${q(table.name, dialect)};`);
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
      const idxName = idx.name || `idx_${table.name}_${idx.fieldIds.map((id) => targetTable.fields.find((f) => f.id === id)?.name ?? id).join("_")}`;
      const unique = idx.unique ? "UNIQUE " : "";
      statements.push(`CREATE ${unique}INDEX IF NOT EXISTS ${q(idxName, dialect)} ON ${q(table.name, dialect)} (${colNames});`);
    }
  }

  // 4. Dropped Refs (Foreign Keys)
  for (const ref of diff.refs.filter((r) => r.status === "dropped")) {
    const fkName = ref.name || `fk_${ref.fromTable}_${ref.fromField}`;
    if (dialect === "postgres") {
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP CONSTRAINT IF EXISTS ${q(fkName, dialect)};`);
    } else if (dialect === "mysql") {
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP FOREIGN KEY ${q(fkName, dialect)};`);
    }
  }

  // 5. Added Refs (Foreign Keys)
  for (const ref of diff.refs.filter((r) => r.status === "added")) {
    const fkName = ref.name || `fk_${ref.fromTable}_${ref.fromField}`;
    if (dialect === "postgres") {
      statements.push(
        `ALTER TABLE ${q(ref.fromTable, dialect)} ADD CONSTRAINT ${q(fkName, dialect)} FOREIGN KEY (${q(ref.fromField, dialect)}) REFERENCES ${q(ref.toTable, dialect)} (${q(ref.toField, dialect)});`,
      );
    } else if (dialect === "mysql") {
      statements.push(
        `ALTER TABLE ${q(ref.fromTable, dialect)} ADD CONSTRAINT ${q(fkName, dialect)} FOREIGN KEY (${q(ref.fromField, dialect)}) REFERENCES ${q(ref.toTable, dialect)} (${q(ref.toField, dialect)});`,
      );
    }
  }

  // Transaction commit
  statements.push("COMMIT;");

  return statements.join("\n\n");
}
