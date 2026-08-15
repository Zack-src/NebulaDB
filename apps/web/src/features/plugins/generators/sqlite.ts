import type { Project, Table } from "@athanordb/shared";

export interface SqliteExportSettings {
  foreignKeys?: boolean;
  ifNotExists?: boolean;
  strictTables?: boolean;
}

function mapToSqliteType(typeStr: string): string {
  const t = String(typeStr || "")
    .toLowerCase()
    .trim();
  if (t.includes("int") || t === "serial" || t === "bigserial" || t === "tinyint" || t === "smallint") {
    return "INTEGER";
  }
  if (t.includes("char") || t.includes("text") || t.includes("uuid") || t.includes("json") || t.includes("enum")) {
    return "TEXT";
  }
  if (
    t.includes("real") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("decimal")
  ) {
    return "REAL";
  }
  if (t.includes("blob") || t.includes("bytea") || t.includes("binary")) {
    return "BLOB";
  }
  if (t.includes("bool")) {
    return "INTEGER";
  }
  return "TEXT";
}

function formatSqliteDefault(defVal: string): string {
  const v = String(defVal).trim();
  if (v.startsWith("'") && v.endsWith("'")) return v;
  if (/^-?\d+(\.\d+)?$/.test(v) || v.toUpperCase() === "NULL" || v.toUpperCase() === "CURRENT_TIMESTAMP") {
    return v;
  }
  return `'${v.replace(/'/g, "''")}'`;
}

export function generateSqlite(project: Project, settings: SqliteExportSettings = {}): string {
  const lines: string[] = [];
  lines.push(`-- ==========================================================`);
  lines.push(`-- Generated SQLite DDL for: ${project.name || "AthanorDB Project"}`);
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push(`-- ==========================================================`);
  lines.push(``);

  if (settings.foreignKeys !== false) {
    lines.push(`PRAGMA foreign_keys = ON;`);
    lines.push(``);
  }

  const tableMap = new Map<string, Table>();
  for (const table of project.tables) {
    tableMap.set(table.id, table);
  }

  for (const table of project.tables) {
    const tableName = table.name;
    const ifNotExistsClause = settings.ifNotExists ? "IF NOT EXISTS " : "";
    const colDefs: string[] = [];

    const pkFields = table.fields.filter((f) => f.pk);
    const isSinglePk = pkFields.length === 1;

    for (const field of table.fields) {
      let col = `  "${field.name}" ${mapToSqliteType(field.type)}`;

      if (field.pk && isSinglePk) {
        if (field.increment) {
          col = `  "${field.name}" INTEGER PRIMARY KEY AUTOINCREMENT`;
        } else {
          col += " PRIMARY KEY";
        }
      }

      if (field.notNull && !(field.pk && isSinglePk)) {
        col += " NOT NULL";
      }

      if (field.unique && !(field.pk && isSinglePk)) {
        col += " UNIQUE";
      }

      if (field.default !== undefined && field.default !== null && field.default !== "") {
        col += ` DEFAULT ${formatSqliteDefault(field.default)}`;
      }

      colDefs.push(col);
    }

    if (pkFields.length > 1) {
      const pkNames = pkFields.map((f) => `"${f.name}"`).join(", ");
      colDefs.push(`  PRIMARY KEY (${pkNames})`);
    }

    const tableRefs = project.refs.filter((r) => r.from.tableId === table.id);
    for (const ref of tableRefs) {
      const targetTable = tableMap.get(ref.to.tableId);
      const fromField = table.fields.find((f) => f.id === ref.from.fieldId);
      const toField = targetTable?.fields.find((f) => f.id === ref.to.fieldId);

      if (targetTable && fromField && toField) {
        const fkClause = `  FOREIGN KEY ("${fromField.name}") REFERENCES "${targetTable.name}" ("${toField.name}")`;
        colDefs.push(fkClause);
      }
    }

    const strictClause = settings.strictTables ? " STRICT" : "";
    lines.push(`CREATE TABLE ${ifNotExistsClause}"${tableName}" (\n${colDefs.join(",\n")}\n)${strictClause};`);
    lines.push(``);

    if (table.indexes && table.indexes.length > 0) {
      for (const idx of table.indexes) {
        const idxFields = idx.fieldIds
          .map((id) => table.fields.find((f) => f.id === id)?.name)
          .filter(Boolean) as string[];
        if (idxFields.length > 0) {
          const idxName = idx.name || `idx_${tableName}_${idxFields.join("_")}`;
          const uniqueKeyword = idx.unique ? "UNIQUE " : "";
          lines.push(
            `CREATE ${uniqueKeyword}INDEX ${ifNotExistsClause}"${idxName}" ON "${tableName}" (${idxFields.map((f) => `"${f}"`).join(", ")});`,
          );
        }
      }
      lines.push(``);
    }
  }

  return lines.join("\n").trim() + "\n";
}
