import type { Project } from "@athanordb/shared";

export interface SchemaAuditReport {
  errors: string[];
  warnings: string[];
  infos: string[];
}

export function auditSchema(project: Project): SchemaAuditReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  const tableNames = new Set<string>();
  const tableIds = new Set(project.tables.map((t) => t.id));

  for (const table of project.tables) {
    const lowName = table.name.toLowerCase();
    if (tableNames.has(lowName)) {
      errors.push(`Table en double détectée : "${table.name}"`);
    }
    tableNames.add(lowName);

    const pkFields = table.fields.filter((f) => f.pk);
    if (pkFields.length === 0) {
      warnings.push(`La table "${table.name}" n'a aucune clé primaire (PK) définie.`);
    }

    const fieldNames = new Set<string>();
    for (const field of table.fields) {
      const lowField = field.name.toLowerCase();
      if (fieldNames.has(lowField)) {
        errors.push(`Champ en double dans "${table.name}" : "${field.name}"`);
      }
      fieldNames.add(lowField);
    }
  }

  // Refs check
  for (const ref of project.refs) {
    if (!tableIds.has(ref.from.tableId)) {
      errors.push(`Relation "${ref.name || "sans nom"}" cible une table source inexistante.`);
    }
    if (!tableIds.has(ref.to.tableId)) {
      errors.push(`Relation "${ref.name || "sans nom"}" cible une table destination inexistante.`);
    }
  }

  // Summary info
  infos.push(
    `Schéma audité : ${project.tables.length} tables, ${project.refs.length} relations, ${project.enums.length} énumérations.`,
  );

  return { errors, warnings, infos };
}
