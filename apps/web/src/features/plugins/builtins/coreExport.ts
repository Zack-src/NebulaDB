import type { Project } from "@athanordb/shared";
import { exportDbml, exportSql } from "@/services/projectsApi";
import {
  generateSqlite,
  generateTypeScript,
  generatePrisma,
  generateMermaid,
  generateJsonSchema,
} from "@/features/plugins/generators";
import type { Contribution, InvokeResult } from "@/features/plugins/types";
import type { BuiltinPlugin, BuiltinRunner } from "./types";

const contributions: Contribution[] = [
  {
    kind: "exporter",
    id: "dbml",
    label: "DBML",
    extension: "dbml",
    description: "Format natif DBML",
  },
  {
    kind: "exporter",
    id: "postgres",
    label: "PostgreSQL",
    extension: "sql",
    description: "Script DDL PostgreSQL",
  },
  {
    kind: "exporter",
    id: "mysql",
    label: "MySQL",
    extension: "sql",
    description: "Script DDL MySQL",
  },
  {
    kind: "exporter",
    id: "mssql",
    label: "SQL Server (MSSQL)",
    extension: "sql",
    description: "Script DDL Microsoft SQL Server",
  },
  {
    kind: "exporter",
    id: "sqlite",
    label: "SQLite DDL",
    extension: "sql",
    description: "Script DDL SQLite avec clés étrangères et autoincrement",
  },
  {
    kind: "exporter",
    id: "typescript",
    label: "TypeScript Interfaces",
    extension: "ts",
    description: "Interfaces TypeScript typées",
  },
  {
    kind: "exporter",
    id: "prisma",
    label: "Prisma Schema",
    extension: "prisma",
    description: "Fichier schema.prisma avec modèles et relations",
  },
  {
    kind: "exporter",
    id: "mermaid",
    label: "Mermaid ERD",
    extension: "mmd",
    description: "Diagramme ERD Mermaid pour Markdown et Notion",
  },
  {
    kind: "exporter",
    id: "json-schema",
    label: "JSON Schema (Draft-07)",
    extension: "json",
    description: "Schémas de validation JSON Schema standard",
  },
];

const runners: Record<string, BuiltinRunner> = {
  "exporter:dbml": async (_input, ctx) => {
    const text = await exportDbml(ctx.projectId, true);
    return { text, extension: "dbml" };
  },
  "exporter:postgres": async (_input, ctx) => {
    const text = await exportSql(ctx.projectId, "postgres");
    return { text, extension: "sql" };
  },
  "exporter:mysql": async (_input, ctx) => {
    const text = await exportSql(ctx.projectId, "mysql");
    return { text, extension: "sql" };
  },
  "exporter:mssql": async (_input, ctx) => {
    const text = await exportSql(ctx.projectId, "mssql");
    return { text, extension: "sql" };
  },
  "exporter:sqlite": (input, _ctx) => {
    const project = input as Project;
    const text = generateSqlite(project, {
      foreignKeys: true,
      ifNotExists: true,
    });
    return { text, extension: "sql" };
  },
  "exporter:typescript": (input, ctx) => {
    const project = input as Project;
    const text = generateTypeScript(project, {
      exportType: (ctx.settings?.tsExportType as "interface" | "type") || "interface",
      camelCaseFields: ctx.settings?.tsCamelCase !== false,
    });
    return { text, extension: "ts" };
  },
  "exporter:prisma": (input, ctx) => {
    const project = input as Project;
    const text = generatePrisma(project, {
      datasourceProvider:
        (ctx.settings?.prismaProvider as "postgresql" | "mysql" | "sqlite" | "sqlserver") || "postgresql",
    });
    return { text, extension: "prisma" };
  },
  "exporter:mermaid": (input) => {
    const project = input as Project;
    const text = generateMermaid(project);
    return { text, extension: "mmd" };
  },
  "exporter:json-schema": (input) => {
    const project = input as Project;
    const text = generateJsonSchema(project);
    return { text, extension: "json" };
  },
};

export const coreExportPlugin: BuiltinPlugin = {
  manifest: {
    id: "athanordb.core-export",
    name: "Exporteurs Natifs",
    version: "1.0.0",
    author: "AthanorDB",
    category: "export",
    description:
      "Exportez vos schémas en DBML, SQL (Postgres, MySQL, SQL Server, SQLite), TypeScript, Prisma et Mermaid.",
    tags: ["export", "sql", "typescript", "prisma", "mermaid", "json-schema"],
    settings: [
      {
        key: "tsExportType",
        label: "Type d'export TypeScript",
        type: "select",
        default: "interface",
        options: ["interface", "type"],
      },
      {
        key: "tsCamelCase",
        label: "Convertir les champs en camelCase en TypeScript",
        type: "boolean",
        default: true,
      },
      {
        key: "prismaProvider",
        label: "Base de données Prisma",
        type: "select",
        default: "postgresql",
        options: ["postgresql", "mysql", "sqlite", "sqlserver"],
      },
    ],
  },
  contributions,
  run: async (kind, id, input, ctx) => {
    const runner = runners[`${kind}:${id}`];
    if (!runner) throw new Error(`Unknown contribution ${kind}:${id}`);
    return (await runner(input, ctx)) as InvokeResult;
  },
};
