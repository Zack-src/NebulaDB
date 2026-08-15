/**
 * Importers for non-standard or user-defined formats converting directly to DBML.
 */

export function importJsonSchemaToDbml(source: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new Error(`JSON Schema invalide : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Le contenu JSON Schema doit être un objet");
  }

  const root = parsed as Record<string, unknown>;
  const definitions = (root.definitions || root.$defs || {}) as Record<string, unknown>;

  const lines: string[] = ["// Importé depuis JSON Schema\n"];

  const tablesToProcess: Array<{ name: string; schema: Record<string, unknown> }> = [];

  if (root.properties && typeof root.properties === "object") {
    tablesToProcess.push({ name: (root.title as string) || "Root", schema: root });
  }

  for (const [name, def] of Object.entries(definitions)) {
    if (def && typeof def === "object") {
      tablesToProcess.push({ name, schema: def as Record<string, unknown> });
    }
  }

  if (tablesToProcess.length === 0) {
    throw new Error("Aucune définition d'objet ('properties' ou 'definitions') trouvée dans le JSON Schema");
  }

  for (const { name, schema } of tablesToProcess) {
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const requiredList = Array.isArray(schema.required) ? schema.required.map(String) : [];
    const tableName = name.replace(/[^a-zA-Z0-9_]/g, "_");

    lines.push(`Table ${tableName} {`);
    let hasPk = false;

    for (const [propName, propDef] of Object.entries(properties)) {
      const safeProp = propName.replace(/[^a-zA-Z0-9_]/g, "_");
      let type = "varchar";
      const rawType = propDef.type;

      if (rawType === "integer") type = "int";
      else if (rawType === "number") type = "decimal";
      else if (rawType === "boolean") type = "boolean";
      else if (rawType === "string") {
        if (propDef.format === "date-time") type = "timestamp";
        else if (propDef.format === "date") type = "date";
        else if (propDef.format === "uuid") type = "uuid";
        else type = "varchar";
      } else if (rawType === "object" || rawType === "array") {
        type = "json";
      }

      const isRequired = requiredList.includes(propName);
      const isId =
        !hasPk && (propName.toLowerCase() === "id" || propName.toLowerCase() === `${tableName.toLowerCase()}_id`);
      if (isId) hasPk = true;

      const settings: string[] = [];
      if (isId) settings.push("pk");
      if (isRequired && !isId) settings.push("not null");
      if (propDef.description) settings.push(`note: '${String(propDef.description).replace(/'/g, "\\'")}'`);

      const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${safeProp} ${type}${settingsStr}`);
    }

    if (Object.keys(properties).length === 0) {
      lines.push("  id int [pk, increment]");
    }

    lines.push("}\n");
  }

  return lines.join("\n");
}

export function importSqliteToDbml(source: string): string {
  const lines: string[] = ["// Importé depuis SQLite DDL\n"];
  const tableRegex = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["`']?([a-zA-Z0-9_]+)["`']?\s*\(([\s\S]*?)\);/gi;

  let match;
  let tableCount = 0;

  while ((match = tableRegex.exec(source)) !== null) {
    tableCount++;
    const tableName = match[1];
    const body = match[2];

    lines.push(`Table ${tableName} {`);

    const colLines = body.split(/,(?![^(]*\))/);
    const foreignKeys: Array<{ from: string; targetTable: string; targetCol: string }> = [];

    for (const rawCol of colLines) {
      const col = rawCol.trim();
      if (!col) continue;

      // Check FOREIGN KEY (...) REFERENCES ...
      const fkMatch =
        /FOREIGN\s+KEY\s*\(["`']?([a-zA-Z0-9_]+)["`']?\)\s*REFERENCES\s*["`']?([a-zA-Z0-9_]+)["`']?\s*\(["`']?([a-zA-Z0-9_]+)["`']?\)/i.exec(
          col,
        );
      if (fkMatch) {
        foreignKeys.push({ from: fkMatch[1], targetTable: fkMatch[2], targetCol: fkMatch[3] });
        continue;
      }

      // Check PRIMARY KEY (...)
      const pkMatch = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(col);
      if (pkMatch) {
        continue;
      }

      // Ordinary column: colName colType [constraints]
      const colParts = col.split(/\s+/);
      const colName = colParts[0].replace(/["`']/g, "");
      const colType = colParts[1] ? colParts[1].toLowerCase() : "text";

      const isPk = /PRIMARY\s+KEY/i.test(col);
      const isAuto = /AUTOINCREMENT/i.test(col);
      const isNotNull = /NOT\s+NULL/i.test(col);
      const isUnique = /UNIQUE/i.test(col);
      const defMatch = /DEFAULT\s+([^,\s]+)/i.exec(col);

      const settings: string[] = [];
      if (isPk) settings.push("pk");
      if (isAuto) settings.push("increment");
      if (isNotNull && !isPk) settings.push("not null");
      if (isUnique && !isPk) settings.push("unique");
      if (defMatch) settings.push(`default: ${defMatch[1]}`);

      const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${colName} ${colType}${settingsStr}`);
    }

    lines.push("}\n");

    // Output Refs
    for (const fk of foreignKeys) {
      lines.push(`Ref: ${tableName}.${fk.from} > ${fk.targetTable}.${fk.targetCol}`);
    }
  }

  if (tableCount === 0) {
    throw new Error("Aucune instruction CREATE TABLE valide trouvée dans la source SQLite");
  }

  return lines.join("\n");
}
