import type { Project } from "@athanordb/shared";

function mapToJsonSchemaType(typeStr: string): string {
  const t = String(typeStr || "")
    .toLowerCase()
    .trim();
  if (t.includes("int") || t === "serial" || t === "bigserial") return "integer";
  if (
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("decimal") ||
    t.includes("real")
  )
    return "number";
  if (t.includes("bool")) return "boolean";
  if (t.includes("json")) return "object";
  if (t.includes("array")) return "array";
  return "string";
}

export function generateJsonSchema(project: Project): string {
  const definitions: Record<string, unknown> = {};

  for (const table of project.tables) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of table.fields) {
      const propDef: Record<string, unknown> = {
        type: mapToJsonSchemaType(field.type),
      };
      if (field.note) {
        propDef.description = field.note;
      }
      if (field.default !== undefined && field.default !== null && field.default !== "") {
        propDef.default = field.default;
      }
      properties[field.name] = propDef;

      if (field.notNull || field.pk) {
        required.push(field.name);
      }
    }

    definitions[table.name] = {
      type: "object",
      title: table.name,
      description: table.note || undefined,
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  const rootSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: project.name || "AthanorDB Schema",
    type: "object",
    definitions,
  };

  return JSON.stringify(rootSchema, null, 2) + "\n";
}
