import type { Project, EnumDef } from "@athanordb/shared";
import { toCamelCase, toPascalCase } from "@/utils/case";

export interface TypeScriptExportSettings {
  exportType?: "interface" | "type";
  camelCaseFields?: boolean;
  includeEnums?: boolean;
  includeComments?: boolean;
}

function mapToTypeScriptType(typeStr: string, enums: EnumDef[]): string {
  const t = String(typeStr || "")
    .toLowerCase()
    .trim();
  const matchedEnum = enums.find((e) => e.name.toLowerCase() === t);
  if (matchedEnum) {
    return toPascalCase(matchedEnum.name);
  }

  if (
    t.includes("int") ||
    t === "serial" ||
    t === "bigserial" ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("decimal") ||
    t.includes("real") ||
    t === "number"
  ) {
    return "number";
  }

  if (
    t.includes("char") ||
    t.includes("text") ||
    t.includes("uuid") ||
    t.includes("date") ||
    t.includes("time") ||
    t === "string"
  ) {
    return "string";
  }

  if (t.includes("bool")) {
    return "boolean";
  }

  if (t.includes("json")) {
    return "Record<string, unknown>";
  }

  if (t.includes("blob") || t.includes("bytea") || t.includes("binary")) {
    return "Uint8Array";
  }

  return "unknown";
}

export function generateTypeScript(project: Project, settings: TypeScriptExportSettings = {}): string {
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * TypeScript models generated from AthanorDB`);
  lines.push(` * Project: ${project.name || "AthanorDB Schema"}`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` */`);
  lines.push(``);

  const exportKeyword = "export";
  const kind = settings.exportType === "type" ? "type" : "interface";

  // 1. Enums
  if (settings.includeEnums !== false && project.enums.length > 0) {
    for (const enumDef of project.enums) {
      const enumTypeName = toPascalCase(enumDef.name);
      lines.push(`/** Values for enum ${enumDef.name} */`);
      const valLiterals = enumDef.values.map((v) => `"${v.name}"`).join(" | ");
      lines.push(`${exportKeyword} type ${enumTypeName} = ${valLiterals || "string"};`);
      lines.push(``);
    }
  }

  // 2. Tables
  for (const table of project.tables) {
    const modelName = toPascalCase(table.name);

    if (table.note && settings.includeComments !== false) {
      lines.push(`/** ${table.note} */`);
    }

    if (kind === "interface") {
      lines.push(`${exportKeyword} interface ${modelName} {`);
    } else {
      lines.push(`${exportKeyword} type ${modelName} = {`);
    }

    for (const field of table.fields) {
      const fieldName = settings.camelCaseFields ? toCamelCase(field.name) : field.name;
      const isOptional = !field.notNull && !field.pk;
      const optMark = isOptional ? "?" : "";
      const tsType = mapToTypeScriptType(field.type, project.enums);

      if (field.note && settings.includeComments !== false) {
        lines.push(`  /** ${field.note} */`);
      }
      lines.push(`  ${fieldName}${optMark}: ${tsType};`);
    }

    lines.push(kind === "interface" ? `}` : `};`);
    lines.push(``);
  }

  return lines.join("\n").trim() + "\n";
}
