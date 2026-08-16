import type { MigrationResolutionMap } from "@athanordb/shared";
import type { MigrationDiff, MigrationFieldChange, MigrationTableChange } from "./migrationDiff.js";
import {
  formatColumnDef,
  generateCreateTable,
  generateDropTable,
  q,
  type MigrationDialect,
} from "./migrationGenerator.js";

export interface RollbackResult {
  /** Best-effort inverse SQL — empty (just the transaction wrapper) if every change was reversible-nothing, i.e. `diff.hasChanges` was false. */
  sql: string;
  /** Human-readable notes for every change rollback cannot actually undo (dropped data, resolution-driven mutations) — always show these next to the SQL, never let the SQL alone imply full recovery. */
  irreversible: string[];
}

/**
 * Generates a best-effort inverse of `generateMigrationSql`'s output for the
 * same `(diff, resolutions)` pair — restoring structure where the forward
 * migration only changed structure, and flagging every place where it also
 * destroyed data, which no generated SQL can bring back.
 *
 * This is deliberately not sold as a full undo. Three engine/data realities
 * make that impossible in general, and this function is honest about all
 * three rather than generating SQL that pretends otherwise:
 *
 * 1. **Dropped data is gone.** A `DROP TABLE`/`DROP COLUMN` (or a
 *    `DROP_DATA_CONFIRMED` resolution) removes rows the database engine
 *    cannot hand back — rollback can recreate the empty structure, never the
 *    data. The only real recovery path is a backup taken before the
 *    deployment ran.
 * 2. **Resolution-driven data mutations aren't tracked row-by-row.**
 *    `BACKFILL_DEFAULT`/`CLEAR_COLUMN_DATA`/`DELETE_OFFENDING_ROWS` change or
 *    remove existing values; this function has no record of what those
 *    values were, so it cannot undo the mutation, only flag that it
 *    happened.
 * 3. **MySQL's DDL isn't transactional at all** (see `migrationGenerator.ts`'s
 *    own note on this) — a MySQL migration that failed partway through has
 *    already permanently applied its earlier statements, and this function's
 *    output describes reversing the *complete* diff, not whichever prefix of
 *    it actually landed. The caller (`connections/routes.ts`) is responsible
 *    for only offering a rollback when it knows what actually executed.
 */
export function generateRollbackSql(
  diff: MigrationDiff,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap = {},
): RollbackResult {
  if (!diff.hasChanges)
    return { sql: `-- No schema differences were deployed — nothing to roll back\n`, irreversible: [] };

  const statements: string[] = [];
  const irreversible: string[] = [];

  if (dialect === "postgres") statements.push("BEGIN;");
  else if (dialect === "mysql") statements.push("START TRANSACTION;");
  else statements.push("BEGIN TRANSACTION;");

  // 1. Tables that were added by the forward migration -> drop them back out.
  for (const table of diff.tables.filter((t) => t.status === "added" && t.after)) {
    statements.push(generateDropTable(table.name, dialect));
  }

  // 2. Tables that were dropped -> recreate the structure; the data is gone.
  for (const table of diff.tables.filter((t) => t.status === "dropped" && t.before)) {
    const resKey = `table:${table.name.toLowerCase()}`;
    if (resolutions[resKey]?.strategy === "KEEP_IN_DB") {
      // The forward migration skipped this drop (the table is still there) — nothing to roll back.
      continue;
    }
    statements.push(generateCreateTable(table.before!, dialect));
    irreversible.push(`Table "${table.name}" is recreated empty — its data was dropped and cannot be restored.`);
  }

  // 3. Modified tables: fields and indexes, each inverted individually.
  for (const table of diff.tables.filter((t) => t.status === "modified")) {
    for (const field of table.fields) {
      statements.push(...invertFieldChange(table, field, dialect, resolutions, irreversible));
    }

    // Indexes the forward migration added -> drop them.
    for (const idx of table.addedIndexes) {
      const idxName = idx.name || `idx_${table.name}_${idx.fieldIds.join("_")}`;
      if (dialect === "mysql") statements.push(`DROP INDEX ${q(idxName, dialect)} ON ${q(table.name, dialect)};`);
      else statements.push(`DROP INDEX IF EXISTS ${q(idxName, dialect)};`);
    }

    // Indexes the forward migration dropped -> recreate them from the pre-migration definition.
    for (const idx of table.droppedIndexes) {
      const sourceTable = table.before!;
      const colNames = idx.fieldIds
        .map((id) => sourceTable.fields.find((f) => f.id === id)?.name ?? id)
        .map((n) => q(n, dialect))
        .join(", ");
      const idxName =
        idx.name ||
        `idx_${table.name}_${idx.fieldIds.map((id) => sourceTable.fields.find((f) => f.id === id)?.name ?? id).join("_")}`;
      const unique = idx.unique ? "UNIQUE " : "";
      statements.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${q(idxName, dialect)} ON ${q(table.name, dialect)} (${colNames});`,
      );
    }
  }

  // 4. Refs added by the forward migration -> drop the constraint.
  for (const ref of diff.refs.filter((r) => r.status === "added")) {
    const fkName = ref.name || `fk_${ref.fromTable}_${ref.fromField}`;
    if (dialect === "postgres")
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP CONSTRAINT IF EXISTS ${q(fkName, dialect)};`);
    else if (dialect === "mysql")
      statements.push(`ALTER TABLE ${q(ref.fromTable, dialect)} DROP FOREIGN KEY ${q(fkName, dialect)};`);
  }

  // 5. Refs dropped by the forward migration -> recreate them.
  for (const ref of diff.refs.filter((r) => r.status === "dropped")) {
    const fkName = ref.name || `fk_${ref.fromTable}_${ref.fromField}`;
    const stmt = `ALTER TABLE ${q(ref.fromTable, dialect)} ADD CONSTRAINT ${q(fkName, dialect)} FOREIGN KEY (${q(ref.fromField, dialect)}) REFERENCES ${q(ref.toTable, dialect)} (${q(ref.toField, dialect)});`;
    if (dialect === "postgres" || dialect === "mysql") statements.push(stmt);
  }

  statements.push("COMMIT;");
  return { sql: statements.join("\n\n"), irreversible };
}

function invertFieldChange(
  tableChange: MigrationTableChange,
  fieldChange: MigrationFieldChange,
  dialect: MigrationDialect,
  resolutions: MigrationResolutionMap,
  irreversible: string[],
): string[] {
  const tableName = tableChange.name;
  const colName = fieldChange.name;
  const resKey = `column:${tableName.toLowerCase()}.${colName.toLowerCase()}`;
  const resolution = resolutions[resKey];

  if (fieldChange.status === "added") {
    if (resolution?.strategy === "KEEP_IN_DB") return []; // forward migration skipped adding it — nothing to undo
    if (dialect === "postgres")
      return [`ALTER TABLE ${q(tableName, dialect)} DROP COLUMN IF EXISTS ${q(colName, dialect)};`];
    return [`ALTER TABLE ${q(tableName, dialect)} DROP COLUMN ${q(colName, dialect)};`];
  }

  if (fieldChange.status === "dropped" && fieldChange.before) {
    if (resolution?.strategy === "KEEP_IN_DB") return []; // forward migration skipped dropping it — nothing to undo
    irreversible.push(
      `Column "${tableName}.${colName}" is recreated empty — its data was dropped and cannot be restored.`,
    );
    return [`ALTER TABLE ${q(tableName, dialect)} ADD COLUMN ${formatColumnDef(fieldChange.before, dialect)};`];
  }

  if (fieldChange.status === "modified" && fieldChange.before && fieldChange.after) {
    const stmts: string[] = [];
    const before = fieldChange.before;

    // Resolution-driven data mutations happened against real rows this
    // function has no record of — flag rather than fabricate an UPDATE that
    // would only be a guess.
    if (resolution?.strategy === "CLEAR_COLUMN_DATA" || resolution?.strategy === "DELETE_OFFENDING_ROWS") {
      irreversible.push(
        `Column "${tableName}.${colName}": the "${resolution.strategy}" resolution changed or removed row data that rollback cannot reconstruct.`,
      );
    } else if (resolution?.strategy === "BACKFILL_DEFAULT") {
      irreversible.push(
        `Column "${tableName}.${colName}": rows backfilled with a default value cannot be told apart from rows that already had it — rollback leaves the backfilled value in place.`,
      );
    }

    if (fieldChange.typeChanged) {
      if (dialect === "postgres") {
        stmts.push(
          `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} TYPE ${before.type} USING ${q(colName, dialect)}::${before.type};`,
        );
      } else if (dialect === "mysql") {
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} MODIFY COLUMN ${formatColumnDef(before, dialect)};`);
      } else {
        stmts.push(`-- SQLite type reverted for ${q(tableName, dialect)}.${q(colName, dialect)} -> ${before.type}`);
      }
    }

    if (fieldChange.notNullChanged && dialect === "postgres") {
      stmts.push(
        before.notNull
          ? `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET NOT NULL;`
          : `ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP NOT NULL;`,
      );
    }

    if (fieldChange.defaultChanged && dialect === "postgres") {
      if (before.default !== undefined && before.default !== "") {
        const d = before.default.trim();
        const defVal =
          d.startsWith("'") || d.startsWith("(") || !Number.isNaN(Number(d)) ? d : `'${d.replace(/'/g, "''")}'`;
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} SET DEFAULT ${defVal};`);
      } else {
        stmts.push(`ALTER TABLE ${q(tableName, dialect)} ALTER COLUMN ${q(colName, dialect)} DROP DEFAULT;`);
      }
    }

    return stmts;
  }

  return [];
}
