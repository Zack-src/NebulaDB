import type { Project, Field } from "@athanordb/shared";
import {
  toSnakeCase,
  toCamelCase,
  toPascalCase,
  auditSchema,
  calculateSchemaStats,
} from "@/features/plugins/generators";
import { computeAutoLayout } from "@/features/editor/canvas/autoLayout";
import { generateId } from "@/utils/id";
import type { Contribution, InvokeResult } from "@/features/plugins/types";
import type { BuiltinPlugin, BuiltinRunner } from "./types";

export const RESET_LINK_ROUTING_ID = "reset-link-routing";
export const AUTO_LAYOUT_ID = "auto-layout";
export const GROUP_TABLES_ID = "group-tables";

const contributions: Contribution[] = [
  {
    kind: "canvasCommand",
    id: AUTO_LAYOUT_ID,
    label: "Réorganiser automatiquement",
    shortcut: "Ctrl+Alt+G",
    description:
      "Repositionne les tables par disposition automatique, en gardant groupes et zones bien séparés les uns des autres.",
  },
  {
    kind: "canvasCommand",
    id: GROUP_TABLES_ID,
    label: "Grouper les tables sélectionnées",
    description: "Crée un TableGroup à partir des tables actuellement sélectionnées sur le canvas (2 minimum).",
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
  [`canvasCommand:${AUTO_LAYOUT_ID}`]: (input) => {
    const project = input as Project;
    const { tables: positions, zones: zoneUpdates } = computeAutoLayout(
      project.tables,
      project.refs,
      project.zones,
      project.tableGroups,
    );
    const tables = project.tables.map((table) => {
      const position = positions.get(table.id);
      return position ? { ...table, position } : table;
    });
    const zones = project.zones.map((zone) => {
      const update = zoneUpdates.get(zone.id);
      return update ? { ...zone, position: update.position, size: update.size } : zone;
    });
    return { project: { ...project, tables, zones } };
  },

  [`canvasCommand:${GROUP_TABLES_ID}`]: (input, ctx) => {
    const project = input as Project;
    const tableIds = ctx.selection?.tableIds ?? [];
    if (tableIds.length < 2) {
      return { message: "Sélectionnez au moins 2 tables pour créer un groupe." };
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
    id: "athanordb.core-canvas",
    name: "Commandes Canvas & Schéma",
    version: "1.0.0",
    author: "AthanorDB",
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
