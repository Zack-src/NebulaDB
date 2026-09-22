import type { RefEdgeType } from "@/features/editor/edges/refEdgeTypes";

/**
 * "Which of this table's columns sit on a highlighted relation", computed
 * **once per edge change** for the whole canvas instead of once per table.
 *
 * Every table node used to answer that question for itself with its own store
 * selector walking the entire edge array, re-run on *every* store mutation —
 * each pan/zoom transform tick included — for O(tables × edges) per update:
 * measured at 1.5 million selector invocations (~1.5s of pure selector time)
 * for a single "highlight links" toggle on a 500-table schema.
 *
 * Here the canvas derives this map from its own edge array (so it only
 * recomputes when an edge's highlight actually changed), and each table reads
 * its own key by id: O(1). The key is a joined string on purpose — it compares
 * with `===`, so a table whose highlighted columns didn't change doesn't
 * update even though the map behind it was rebuilt.
 */
export type HighlightedFieldsMap = Map<string, string>;

/** `fieldId-left-source` -> `fieldId`. */
const HANDLE_SUFFIX = /-(left|right)-(source|target)$/;
const stripHandleSuffix = (handle: string) => handle.replace(HANDLE_SUFFIX, "");

export function computeHighlightedFields(edges: RefEdgeType[]): HighlightedFieldsMap {
  const byTable = new Map<string, string[]>();
  const push = (tableId: string, handle: string) => {
    const list = byTable.get(tableId);
    if (list) list.push(stripHandleSuffix(handle));
    else byTable.set(tableId, [stripHandleSuffix(handle)]);
  };
  for (const edge of edges) {
    if (!edge.selected && !edge.data?.connectedHighlight) continue;
    if (edge.sourceHandle) push(edge.source, edge.sourceHandle);
    if (edge.targetHandle) push(edge.target, edge.targetHandle);
  }
  const keys: HighlightedFieldsMap = new Map();
  for (const [tableId, fieldIds] of byTable) keys.set(tableId, fieldIds.sort().join("|"));
  return keys;
}
