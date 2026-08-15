import type { Project, EnumDef } from "@athanordb/shared";
import { toPascalCase, toCamelCase } from "@/utils/case";

export interface PrismaExportSettings {
  datasourceProvider?: "postgresql" | "mysql" | "sqlite" | "sqlserver";
  datasourceUrlEnv?: string;
  clientGenerator?: boolean;
}

function mapToPrismaType(typeStr: string, enums: EnumDef[]): string {
  const t = String(typeStr || "")
    .toLowerCase()
    .trim();
  const matchedEnum = enums.find((e) => e.name.toLowerCase() === t);
  if (matchedEnum) {
    return toPascalCase(matchedEnum.name);
  }

  if (t === "serial" || t === "int" || t === "integer" || t === "smallint" || t === "tinyint") return "Int";
  if (t === "bigint" || t === "bigserial") return "BigInt";
  if (t.includes("float") || t.includes("double") || t.includes("real")) return "Float";
  if (t.includes("decimal") || t.includes("numeric")) return "Decimal";
  if (t.includes("bool")) return "Boolean";
  if (t.includes("date") || t.includes("time") || t === "timestamp") return "DateTime";
  if (t.includes("json")) return "Json";
  if (t.includes("blob") || t.includes("bytea") || t.includes("binary")) return "Bytes";
  return "String";
}

export function generatePrisma(project: Project, settings: PrismaExportSettings = {}): string {
  const lines: string[] = [];
  const provider = settings.datasourceProvider || "postgresql";
  const urlEnv = settings.datasourceUrlEnv || "DATABASE_URL";

  if (settings.clientGenerator !== false) {
    lines.push(`generator client {`);
    lines.push(`  provider = "prisma-client-js"`);
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`datasource db {`);
  lines.push(`  provider = "${provider}"`);
  lines.push(`  url      = env("${urlEnv}")`);
  lines.push(`}`);
  lines.push(``);

  // Enums
  for (const enumDef of project.enums) {
    lines.push(`enum ${toPascalCase(enumDef.name)} {`);
    for (const val of enumDef.values) {
      lines.push(`  ${val.name}`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  const tableMap = new Map(project.tables.map((t) => [t.id, t]));

  // Models
  for (const table of project.tables) {
    const modelName = toPascalCase(table.name);
    lines.push(`model ${modelName} {`);

    const pkFields = table.fields.filter((f) => f.pk);
    const isSinglePk = pkFields.length === 1;

    for (const field of table.fields) {
      const fieldName = toCamelCase(field.name);
      let prismaType = mapToPrismaType(field.type, project.enums);
      const isOptional = !field.notNull && !field.pk;
      if (isOptional) prismaType += "?";

      const attrs: string[] = [];

      if (field.name !== fieldName) {
        attrs.push(`@map("${field.name}")`);
      }

      if (field.pk && isSinglePk) {
        attrs.push("@id");
        if (field.increment) {
          attrs.push("@default(autoincrement())");
        } else if (field.type.toLowerCase().includes("uuid")) {
          attrs.push("@default(uuid())");
        }
      }

      if (field.unique && !(field.pk && isSinglePk)) {
        attrs.push("@unique");
      }

      if (field.default !== undefined && field.default !== null && field.default !== "" && !field.increment) {
        const def = String(field.default).trim();
        if (def.toUpperCase() === "NOW()" || def.toUpperCase() === "CURRENT_TIMESTAMP") {
          attrs.push("@default(now())");
        } else if (def === "true" || def === "false" || /^-?\d+(\.\d+)?$/.test(def)) {
          attrs.push(`@default(${def})`);
        } else {
          attrs.push(`@default("${def.replace(/"/g, '\\"')}")`);
        }
      }

      const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
      lines.push(`  ${fieldName.padEnd(16)} ${prismaType}${attrStr}`);
    }

    // Relations out
    const outgoingRefs = project.refs.filter((r) => r.from.tableId === table.id);
    for (const ref of outgoingRefs) {
      const targetTable = tableMap.get(ref.to.tableId);
      const fromField = table.fields.find((f) => f.id === ref.from.fieldId);
      const toField = targetTable?.fields.find((f) => f.id === ref.to.fieldId);

      if (targetTable && fromField && toField) {
        const relName = toCamelCase(targetTable.name);
        const targetModel = toPascalCase(targetTable.name);
        const fromFieldName = toCamelCase(fromField.name);
        const toFieldName = toCamelCase(toField.name);
        lines.push(
          `  ${relName.padEnd(16)} ${targetModel} @relation(fields: [${fromFieldName}], references: [${toFieldName}])`,
        );
      }
    }

    if (pkFields.length > 1) {
      const pkFieldNames = pkFields.map((f) => toCamelCase(f.name)).join(", ");
      lines.push(`  @@id([${pkFieldNames}])`);
    }

    if (table.name !== modelName) {
      lines.push(`  @@map("${table.name}")`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join("\n").trim() + "\n";
}
