import type { RefEdgeType } from "@/features/editor/edges/refEdgeTypes";

/**
 * "Which of this table's columns sit on a highlighted relation", computed **once per edge
 * change** for the whole canvas instead of once per table (a per-table store selector over every
 * edge was O(tables x edges) per store update). Each table reads its key by id: O(1). The key is
 * a joined string so an unchanged table compares `===` and doesn't update.
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
