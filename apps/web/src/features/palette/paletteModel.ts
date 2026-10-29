import type { AdminConnectionSummary } from "@nebuladb/shared";
import { ADMIN_SECTIONS, type AdminSection } from "@/features/admin/adminSections";
import { fuzzyScore } from "@/features/editor/dbml/fuzzyScore";
import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
import { visibleWorkspaceTabs } from "@/features/projects/workspaceTabs";
import type { TranslationKey } from "@/i18n/translate";
import type { SearchHit } from "@/services/searchApi";
import type { PermissionLevel } from "@/types";

/** Fewer characters than this and the server search is not worth a request. */
export const MIN_SERVER_QUERY = 2;

const MAX_LOCAL = 8;
const MAX_CONNECTIONS = 6;
const MAX_SERVER = 20;

export type PaletteGroupId = "tables" | "go" | "connections" | "search";

/** What choosing an entry does; the component maps it onto the app's handlers. */
export type PaletteAction =
  | { type: "view"; view: "app" | "bases" | "settings" }
  | { type: "admin"; section: AdminSection; connectionId?: string }
  | { type: "projectTab"; tab: WorkspaceTab }
  | { type: "table"; projectId: string; tableName: string; fieldName?: string }
  | { type: "project"; projectId: string };

export interface PaletteEntry {
  id: string;
  group: PaletteGroupId;
  label: string;
  detail?: string;
  /** Badge text key: what sort of thing a search result is. */
  kind?: "table" | "field" | "enum";
  action: PaletteAction;
}

export interface PaletteGroup {
  id: PaletteGroupId;
  entries: PaletteEntry[];
}

/** The slice of the open project's document the palette can search without a round trip. */
export interface LocalTable {
  name: string;
  schemaName?: string;
  fields: { name: string; type: string }[];
}

type Translate = (key: TranslationKey) => string;

/**
 * The places this user may jump to: the project's tabs when one is open (the
 * same list the tab bar shows), the top-level views, and the admin console's
 * tabs for instance administrators only.
 */
export function navigationTargets(
  user: { isAdmin: boolean },
  project: { name: string; permission: PermissionLevel } | null,
  t: Translate,
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  if (project) {
    for (const tab of visibleWorkspaceTabs(project.permission)) {
      entries.push({
        id: `tab:${tab}`,
        group: "go",
        label: t(`workspace.tab.${tab}`),
        detail: project.name,
        action: { type: "projectTab", tab },
      });
    }
  }
  entries.push(
    { id: "view:app", group: "go", label: t("projects.title"), action: { type: "view", view: "app" } },
    { id: "view:bases", group: "go", label: t("shell.bases"), action: { type: "view", view: "bases" } },
    {
      id: "view:settings",
      group: "go",
      label: t("navbar.accountSettings"),
      action: { type: "view", view: "settings" },
    },
  );
  if (user.isAdmin) {
    for (const section of ADMIN_SECTIONS) {
      entries.push({
        id: `admin:${section.key}`,
        group: "go",
        label: t(section.labelKey),
        detail: t("common.admin"),
        action: { type: "admin", section: section.key },
      });
    }
  }
  return entries;
}

/** Items whose `textOf` matches `query`, best first; the input order is kept for an empty query. */
function rankBy<T>(query: string, items: T[], textOf: (item: T) => string): T[] {
  const needle = query.trim();
  if (!needle) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(needle, textOf(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

/** Entries matching `query` on their label and detail, best first. */
export function rankEntries(query: string, entries: PaletteEntry[]): PaletteEntry[] {
  return rankBy(query, entries, (entry) => `${entry.label} ${entry.detail ?? ""}`);
}

/** The open project's own tables and columns matching `query` — instant, no server involved. */
export function localTableEntries(query: string, projectId: string, tables: LocalTable[]): PaletteEntry[] {
  const needle = query.trim();
  if (!needle) return [];
  const candidates: PaletteEntry[] = [];
  for (const table of tables) {
    candidates.push({
      id: `local:table:${table.schemaName ?? ""}.${table.name}`,
      group: "tables",
      label: table.name,
      detail: table.schemaName,
      kind: "table",
      action: { type: "table", projectId, tableName: table.name },
    });
    for (const field of table.fields) {
      candidates.push({
        id: `local:field:${table.schemaName ?? ""}.${table.name}.${field.name}`,
        group: "tables",
        label: `${table.name}.${field.name}`,
        detail: field.type,
        kind: "field",
        action: { type: "table", projectId, tableName: table.name, fieldName: field.name },
      });
    }
  }
  // Match on the label alone: a column's type in `detail` would pull in every `int`.
  return rankBy(needle, candidates, (entry) => entry.label).slice(0, MAX_LOCAL);
}

/** Instance connections matching `query`, for the admin's jump into a console. */
export function connectionEntries(query: string, connections: AdminConnectionSummary[]): PaletteEntry[] {
  const needle = query.trim();
  if (!needle) return [];
  return rankBy(needle, connections, (c) => [c.name, c.engine, c.environment ?? "", c.host ?? "", ...c.tags].join(" "))
    .slice(0, MAX_CONNECTIONS)
    .map((connection) => ({
      id: `connection:${connection.id}`,
      group: "connections" as const,
      label: connection.name,
      detail: [connection.engine, connection.environment].filter(Boolean).join(" · "),
      action: { type: "admin" as const, section: "connections" as const, connectionId: connection.id },
    }));
}

/**
 * Server hits in the server's own order. When a project is open its tables
 * and columns are already answered locally, so only its enums (which the
 * local search does not cover) survive from that project.
 */
export function searchEntries(hits: SearchHit[], openProjectId: string | null): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  hits.forEach((hit, index) => {
    if (hit.projectId === openProjectId && hit.kind !== "enum") return;
    const id = `hit:${index}`;
    if (hit.kind === "enum" || !hit.tableName) {
      entries.push({
        id,
        group: "search",
        label: hit.enumName ?? hit.projectName,
        detail: hit.projectName,
        kind: "enum",
        action: { type: "project", projectId: hit.projectId },
      });
    } else {
      entries.push({
        id,
        group: "search",
        label: hit.kind === "field" ? `${hit.tableName}.${hit.fieldName}` : hit.tableName,
        detail: hit.projectName,
        kind: hit.kind,
        action: { type: "table", projectId: hit.projectId, tableName: hit.tableName, fieldName: hit.fieldName },
      });
    }
  });
  return entries.slice(0, MAX_SERVER);
}

export interface PaletteSources {
  query: string;
  navigation: PaletteEntry[];
  localTables: PaletteEntry[];
  connections: PaletteEntry[];
  hits: PaletteEntry[];
}

/**
 * Groups in display order: the open project's tables first, then places to
 * go, then connections, then the cross-project search. An empty query lists
 * the places alone; empty groups are dropped so no bare heading shows.
 */
export function buildGroups(sources: PaletteSources): PaletteGroup[] {
  const searching = sources.query.trim().length > 0;
  const groups: PaletteGroup[] = [
    { id: "tables", entries: sources.localTables },
    { id: "go", entries: rankEntries(sources.query, sources.navigation) },
    { id: "connections", entries: searching ? sources.connections : [] },
    { id: "search", entries: searching ? sources.hits : [] },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

export function flattenGroups(groups: PaletteGroup[]): PaletteEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** Arrow-key step through `length` items, wrapping at both ends; -1 when there is nothing to select. */
export function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  return (current + delta + length) % length;
}
