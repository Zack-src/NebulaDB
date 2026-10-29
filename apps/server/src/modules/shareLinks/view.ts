import { buildDictionary, type DataDictionary } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";

/**
 * The dictionary a share link shows: what each table and column is —
 * description, classification, tags, type and constraints — and nothing else.
 *
 * Built field by field rather than by deleting from `buildDictionary`'s
 * result, so a field added there later stays out of a public page until
 * someone decides it belongs in one. The `owner` annotation is left out on
 * purpose: it is free text the project writes, and in practice it names a
 * person or a team contact, which a page for people outside the instance
 * must not publish.
 */
export function publicDictionary(project: Project): DataDictionary {
  const dictionary = buildDictionary(project);
  return {
    projectName: dictionary.projectName,
    tables: dictionary.tables.map((table) => ({
      id: table.id,
      name: table.name,
      schemaName: table.schemaName,
      description: table.description,
      classification: table.classification,
      tags: table.tags,
      columns: table.columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        constraints: column.constraints,
        description: column.description,
        classification: column.classification,
        tags: column.tags,
      })),
    })),
    enums: dictionary.enums.map((def) => ({
      id: def.id,
      name: def.name,
      values: def.values.map((value) => ({ name: value.name, description: value.description })),
      usedBy: def.usedBy,
    })),
    completeness: dictionary.completeness,
  };
}
