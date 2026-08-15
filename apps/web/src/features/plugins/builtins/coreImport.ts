import { convertSqlToDbml } from "@/services/convertApi";
import { importJsonSchemaToDbml, importSqliteToDbml } from "@/features/plugins/importers";
import type { Contribution, InvokeResult } from "@/features/plugins/types";
import type { BuiltinPlugin, BuiltinRunner } from "./types";

const contributions: Contribution[] = [
  {
    kind: "importer",
    id: "dbml",
    label: "DBML",
    fileExtensions: ["dbml"],
    description: "Fichier de schéma DBML",
  },
  {
    kind: "importer",
    id: "postgres",
    label: "PostgreSQL DDL",
    fileExtensions: ["sql"],
    description: "Script SQL PostgreSQL",
  },
  {
    kind: "importer",
    id: "mysql",
    label: "MySQL DDL",
    fileExtensions: ["sql"],
    description: "Script SQL MySQL",
  },
  {
    kind: "importer",
    id: "mssql",
    label: "SQL Server DDL",
    fileExtensions: ["sql"],
    description: "Script SQL Server",
  },
  {
    kind: "importer",
    id: "sqlite",
    label: "SQLite DDL",
    fileExtensions: ["sql", "sqlite", "db"],
    description: "Script SQLite DDL (CREATE TABLE)",
  },
  {
    kind: "importer",
    id: "json-schema",
    label: "JSON Schema",
    fileExtensions: ["json"],
    description: "Définitions JSON Schema",
  },
];

const runners: Record<string, BuiltinRunner> = {
  "importer:dbml": (input) => ({ dbml: String(input ?? "") }),
  "importer:postgres": async (input) => {
    const res = await convertSqlToDbml(String(input ?? ""), "postgres");
    return { dbml: res.dbml };
  },
  "importer:mysql": async (input) => {
    const res = await convertSqlToDbml(String(input ?? ""), "mysql");
    return { dbml: res.dbml };
  },
  "importer:mssql": async (input) => {
    const res = await convertSqlToDbml(String(input ?? ""), "mssql");
    return { dbml: res.dbml };
  },
  "importer:sqlite": (input) => {
    const dbml = importSqliteToDbml(String(input ?? ""));
    return { dbml };
  },
  "importer:json-schema": (input) => {
    const dbml = importJsonSchemaToDbml(String(input ?? ""));
    return { dbml };
  },
};

export const coreImportPlugin: BuiltinPlugin = {
  manifest: {
    id: "athanordb.core-import",
    name: "Importeurs Natifs",
    version: "1.0.0",
    author: "AthanorDB",
    category: "import",
    description: "Importez vos schémas depuis DBML, SQL (Postgres, MySQL, MSSQL, SQLite) et JSON Schema.",
    tags: ["import", "sql", "sqlite", "json-schema"],
  },
  contributions,
  run: async (kind, id, input, ctx) => {
    const runner = runners[`${kind}:${id}`];
    if (!runner) throw new Error(`Unknown contribution ${kind}:${id}`);
    return (await runner(input, ctx)) as InvokeResult;
  },
};
