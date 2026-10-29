import type * as Y from "yjs";
import { addSuggestedIndex } from "@nebuladb/dbml-engine";
import { getTablesMap, readProjectFromDoc } from "@nebuladb/shared";
import { connectProject } from "@/features/collaboration/yjsClient";
import { fetchProject } from "@/services/projectsApi";
import { generateId } from "@/utils/id";

export type AddIndexOutcome = "added" | "exists" | "missing" | "readOnly";

/** How long the project's document may take to arrive, and how long to leave it before hanging up. */
const SYNC_TIMEOUT_MS = 10_000;
const FLUSH_MS = 300;

export interface SuggestedIndex {
  table: string;
  schema: string | null;
  columns: string[];
}

/**
 * Adds the index to the document the way the linter's foreign-key fix does: a plain index on the
 * table, one change to its entry in the tables map. `missing` when the table or one of the columns
 * is not in the schema, `exists` when an index already starts with these columns.
 */
export function addIndexToDoc(doc: Y.Doc, suggestion: SuggestedIndex): Exclude<AddIndexOutcome, "readOnly"> {
  const project = readProjectFromDoc(doc, "", "");
  const lower = (name: string) => name.toLowerCase();
  const table = project.tables.find((t) => lower(t.name) === lower(suggestion.table));
  const known = table && suggestion.columns.every((c) => table.fields.some((f) => lower(f.name) === lower(c)));
  if (!table || !known) return "missing";
  const fixed = addSuggestedIndex(project, suggestion.table, suggestion.columns, generateId, suggestion.schema);
  const changed = fixed?.tables.find((t) => t.id === table.id);
  if (!changed) return "exists";
  getTablesMap(doc).set(changed.id, changed);
  return "added";
}

/**
 * Opens the project's document for a moment, adds the index, and lets go. The change then travels
 * the project's usual way: it shows in the schema and in the next deployment's plan.
 */
export async function addIndexToProject(projectId: string, suggestion: SuggestedIndex): Promise<AddIndexOutcome> {
  if ((await fetchProject(projectId)).permission === "view") return "readOnly";
  return new Promise<AddIndexOutcome>((resolve, reject) => {
    let handled = false;
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      peer.disconnect();
      reject(new Error("project document unreachable"));
    }, SYNC_TIMEOUT_MS);
    const peer = connectProject(projectId, "Nebula", undefined, undefined, () => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try {
        const outcome = addIndexToDoc(peer.doc, suggestion);
        // The update leaves on the socket at once; hang up once it had time to.
        setTimeout(() => {
          peer.disconnect();
          resolve(outcome);
        }, FLUSH_MS);
      } catch (err) {
        peer.disconnect();
        reject(err);
      }
    });
  });
}
