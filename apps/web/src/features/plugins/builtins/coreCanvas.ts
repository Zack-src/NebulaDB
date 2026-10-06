import type { Project, Field } from "@nebuladb/shared";
import {
  toSnakeCase,
  toCamelCase,
  toPascalCase,
  auditSchema,
  calculateSchemaStats,
} from "@/features/plugins/generators";
import { generateId } from "@/utils/id";
import type { Contribution, InvokeResult } from "@/features/plugins/types";
import type { BuiltinPlugin, BuiltinRunner } from "./types";

const RESET_LINK_ROUTING_ID = "reset-link-routing";
export const GROUP_TABLES_ID = "group-tables";

const contributions: Contribution[] = [
  {
    kind: "canvasCommand",
    id: GROUP_TABLES_ID,
    label: "Grouper les tables sélectionnées",
    description:
      "Crée un TableGroup à partir des tables actuellement sélectionnées sur le canvas (2 minimum). " +
      "Si la sélection correspond exactement à un groupe existant, le dissout à la place plutôt que d'en empiler un second.",
  },
  {
    kind: "canvasCommand",
    id: RESET_LINK_ROUTING_ID,
    label: "Réinitialiser le tracé des liens",
    shortcut: "Ctrl+Alt+R",
    description: "Efface tous les waypoints personnalisés des relations.",
  },
  {
    kind: "canvasCommand",
    id: "to-snake-case",
    label: "Convertir en snake_case",
    shortcut: "Ctrl+Alt+K",
    description: "Transforme le nom de toutes les tables et colonnes en snake_case standard.",
  },
  {
    kind: "canvasCommand",
    id: "to-camel-case",
    label: "Convertir les champs en camelCase",
    description: "Transforme le nom des colonnes en camelCase.",
  },
  {
    kind: "canvasCommand",
    id: "to-pascal-case-tables",
    label: "Convertir les tables en PascalCase",
    description: "Transforme le nom de toutes les tables en PascalCase.",
  },
  {
    kind: "canvasCommand",
    id: "add-timestamps",
    label: "Ajouter created_at & updated_at",
    shortcut: "Ctrl+Alt+U",
    description: "Ajoute automatiquement les champs created_at et updated_at aux tables qui ne les possèdent pas.",
  },
  {
    kind: "canvasCommand",
    id: "add-uuid-pk",
    label: "Ajouter PK UUID aux tables sans clé",
    description: "Ajoute un champ id UUID PK aux tables sans clé primaire.",
  },
  {
    kind: "canvasCommand",
    id: "audit-schema",
    label: "Auditer la qualité du schéma",
    description: "Analyse le schéma à la recherche d'erreurs, tables sans PK et doublons.",
  },
  {
    kind: "canvasCommand",
    id: "schema-stats",
    label: "Statistiques et métriques globales",
    description: "Calcule le nombre de tables, champs, relations et complexité moyenne.",
  },
];

const runners: Record<string, BuiltinRunner> = {
  [`canvasCommand:${GROUP_TABLES_ID}`]: (input, ctx) => {
    const project = input as Project;
    const tableIds = ctx.selection?.tableIds ?? [];
    if (tableIds.length < 2) {
      return { message: "Sélectionnez au moins 2 tables pour créer un groupe." };
    }

    // Re-selecting the exact membership of an existing group and hitting
    // "Grouper" again used to stack a second, redundant TableGroup on the
    // same tables. Toggle to dissolving that group instead — a cheap,
    // unambiguous way to "ungroup" without a separate command, since the
    // only way to reach this state is picking precisely a group's tables.
    const selectedSet = new Set(tableIds);
    const existingGroup = project.tableGroups.find(
      (g) => g.tableIds.length === selectedSet.size && g.tableIds.every((id) => selectedSet.has(id)),
    );
    if (existingGroup) {
      return {
        project: { ...project, tableGroups: project.tableGroups.filter((g) => g.id !== existingGroup.id) },
        message: `Groupe "${existingGroup.name}" dissous.`,
      };
    }

    const group = { id: generateId(), name: `group_${project.tableGroups.length + 1}`, tableIds };
    return {
      project: { ...project, tableGroups: [...project.tableGroups, group] },
      message: `Groupe "${group.name}" créé avec ${tableIds.length} tables.`,
    };
  },

  [`canvasCommand:${RESET_LINK_ROUTING_ID}`]: (input) => {
    const project = input as Project;
    const stripped = project.refs.map((r) => {
      if (!r.routingPoints || r.routingPoints.length === 0) return r;
      const copy = { ...r };
      delete copy.routingPoints;
      return copy;
    });
    return { project: { ...project, refs: stripped } };
  },

  "canvasCommand:to-snake-case": (input) => {
    const project = input as Project;
    const updatedTables = project.tables.map((table) => ({
      ...table,
      name: toSnakeCase(table.name),
      fields: table.fields.map((f) => ({ ...f, name: toSnakeCase(f.name) })),
    }));
    return {
      project: { ...project, tables: updatedTables },
      message: "Noms convertis en snake_case avec succès !",
    };
  },

  "canvasCommand:to-camel-case": (input) => {
    const project = input as Project;
    const updatedTables = project.tables.map((table) => ({
      ...table,
      fields: table.fields.map((f) => ({ ...f, name: toCamelCase(f.name) })),
    }));
    return {
      project: { ...project, tables: updatedTables },
      message: "Champs convertis en camelCase !",
    };
  },

  "canvasCommand:to-pascal-case-tables": (input) => {
    const project = input as Project;
    const updatedTables = project.tables.map((table) => ({
      ...table,
      name: toPascalCase(table.name),
    }));
    return {
      project: { ...project, tables: updatedTables },
      message: "Noms de tables convertis en PascalCase !",
    };
  },

  "canvasCommand:add-timestamps": (input) => {
    const project = input as Project;
    let addedCount = 0;
    const updatedTables = project.tables.map((table) => {
      const hasCreatedAt = table.fields.some((f) => toSnakeCase(f.name) === "created_at");
      const hasUpdatedAt = table.fields.some((f) => toSnakeCase(f.name) === "updated_at");

      const newFields = [...table.fields];
      if (!hasCreatedAt) {
        newFields.push({
          id: `f-${table.id}-created_at`,
          name: "created_at",
          type: "timestamp",
          default: "now()",
          notNull: true,
        } as Field);
        addedCount++;
      }
      if (!hasUpdatedAt) {
        newFields.push({
          id: `f-${table.id}-updated_at`,
          name: "updated_at",
          type: "timestamp",
          default: "now()",
          notNull: true,
        } as Field);
        addedCount++;
      }

      return { ...table, fields: newFields };
    });

    return {
      project: { ...project, tables: updatedTables },
      message: `Timestamps ajoutés (${addedCount} champs créés).`,
    };
  },

  "canvasCommand:add-uuid-pk": (input) => {
    const project = input as Project;
    let addedPkCount = 0;
    const updatedTables = project.tables.map((table) => {
      const hasPk = table.fields.some((f) => f.pk);
      if (hasPk) return table;

      const newFields: Field[] = [
        {
          id: `f-${table.id}-id`,
          name: "id",
          type: "uuid",
          pk: true,
          notNull: true,
        } as Field,
        ...table.fields,
      ];
      addedPkCount++;
      return { ...table, fields: newFields };
    });

    return {
      project: { ...project, tables: updatedTables },
      message: `${addedPkCount} clé(s) primaire(s) UUID ajoutée(s).`,
    };
  },

  "canvasCommand:audit-schema": (input) => {
    const project = input as Project;
    const report = auditSchema(project);
    const parts: string[] = [];
    if (report.errors.length > 0) parts.push(`❌ ${report.errors.length} erreur(s) : ${report.errors.join(", ")}`);
    if (report.warnings.length > 0)
      parts.push(`⚠️ ${report.warnings.length} avertissement(s) : ${report.warnings.join(", ")}`);
    if (parts.length === 0) parts.push("✅ Schéma sain, aucune anomalie détectée !");
    return { message: parts.join(" | ") };
  },

  "canvasCommand:schema-stats": (input) => {
    const project = input as Project;
    const stats = calculateSchemaStats(project);
    return {
      message: `📊 Statistiques : ${stats.tableCount} tables, ${stats.fieldCount} champs (moy. ${stats.avgFieldsPerTable}/table), ${stats.refCount} relations, ${stats.enumCount} enums.`,
    };
  },
};

export const coreCanvasPlugin: BuiltinPlugin = {
  manifest: {
    id: "nebuladb.core-canvas",
    name: "Commandes Canvas & Schéma",
    version: "1.0.0",
    author: "NebulaDB",
    category: "canvas",
    description:
      "Outils d'édition de canvas : réinitialisation du routage, conversions de casse, timestamps, audit et statistiques.",
    tags: ["canvas", "format", "tools", "audit", "stats"],
  },
  contributions,
  run: async (kind, id, input, ctx) => {
    const runner = runners[`${kind}:${id}`];
    if (!runner) throw new Error(`Unknown contribution ${kind}:${id}`);
    return (await runner(input, ctx)) as InvokeResult;
  },
};
