import type { Project } from "@athanordb/shared";
import { peekRoom } from "../../realtime/roomRegistry.js";
import { readProjectReadOnly, snapshotVersion } from "../../realtime/readOnlyProject.js";

/**
 * Cross-project search over schema *names* — tables, columns, enums — for
 * "where is `customer_id` used across everything I can see?".
 *
 * Reads each project's content without side effects: a live room's doc if
 * one is already resident (it's the freshest copy, and costs nothing), else
 * the stored snapshot decoded into a throwaway `Y.Doc` — never `getRoom()`,
 * which would spin up a room (and its timers) per project per search.
 *
 * Decoding every snapshot on every keystroke would be the expensive part, so
 * the extracted names are cached per project, keyed by the snapshot's
 * `updated_at`: a project nobody has touched costs one indexed SQLite read
 * per search. Live rooms are read directly and never cached (their content
 * moves faster than the snapshot does).
 */

export interface IndexedTable {
  id: string;
  name: string;
  note: string;
  fields: { name: string; type: string }[];
}

export interface ProjectNameIndex {
  tables: IndexedTable[];
  enums: string[];
}

const cache = new Map<string, { version: string; index: ProjectNameIndex }>();

function extract(project: Project): ProjectNameIndex {
  return {
    tables: project.tables.map((table) => ({
      id: table.id,
      name: table.name,
      note: table.note ?? "",
      fields: table.fields.map((field) => ({ name: field.name, type: field.type ?? "" })),
    })),
    enums: project.enums.map((enumDef) => enumDef.name),
  };
}

export function getProjectNameIndex(projectId: string): ProjectNameIndex {
  if (peekRoom(projectId)) return extract(readProjectReadOnly(projectId, ""));

  const version = snapshotVersion(projectId);
  if (!version) return { tables: [], enums: [] };
  const cached = cache.get(projectId);
  if (cached && cached.version === version) return cached.index;
  const index = extract(readProjectReadOnly(projectId, ""));
  cache.set(projectId, { version, index });
  return index;
}

/** Drops a deleted project's cached names — otherwise the cache only ever grows with the project count. */
export function forgetProjectIndex(projectId: string): void {
  cache.delete(projectId);
}

export type SearchHitKind = "table" | "field" | "enum";

export interface SearchHit {
  projectId: string;
  projectName: string;
  kind: SearchHitKind;
  /** The table a field/table hit belongs to — what the client centres the canvas on. Absent for enums. */
  tableId?: string;
  tableName?: string;
  fieldName?: string;
  fieldType?: string;
  enumName?: string;
  /** 0 = exact, 1 = prefix, 2 = substring (name), 3 = matched only in a table note. Lower sorts first. */
  rank: number;
}

function rankOf(name: string, needle: string): number | null {
  const lower = name.toLowerCase();
  if (lower === needle) return 0;
  if (lower.startsWith(needle)) return 1;
  if (lower.includes(needle)) return 2;
  return null;
}

export const MIN_QUERY_LENGTH = 2;
export const MAX_HITS = 100;

export function searchProjects(
  projects: { id: string; name: string }[],
  query: string,
): {
  hits: SearchHit[];
  truncated: boolean;
} {
  const needle = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const project of projects) {
    const index = getProjectNameIndex(project.id);
    const base = { projectId: project.id, projectName: project.name };
    for (const table of index.tables) {
      const tableRank = rankOf(table.name, needle);
      if (tableRank !== null) {
        hits.push({ ...base, kind: "table", tableId: table.id, tableName: table.name, rank: tableRank });
      } else if (table.note.toLowerCase().includes(needle)) {
        hits.push({ ...base, kind: "table", tableId: table.id, tableName: table.name, rank: 3 });
      }
      for (const field of table.fields) {
        const fieldRank = rankOf(field.name, needle);
        if (fieldRank === null) continue;
        hits.push({
          ...base,
          kind: "field",
          tableId: table.id,
          tableName: table.name,
          fieldName: field.name,
          fieldType: field.type,
          rank: fieldRank,
        });
      }
    }
    for (const enumName of index.enums) {
      const enumRank = rankOf(enumName, needle);
      if (enumRank !== null) hits.push({ ...base, kind: "enum", enumName, rank: enumRank });
    }
  }
  const kindOrder: Record<SearchHitKind, number> = { table: 0, field: 1, enum: 2 };
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.projectName.localeCompare(b.projectName) ||
      (a.tableName ?? a.enumName ?? "").localeCompare(b.tableName ?? b.enumName ?? ""),
  );
  return { hits: hits.slice(0, MAX_HITS), truncated: hits.length > MAX_HITS };
}
