import type { Table } from "@athanordb/shared";
import type { TableNodeType } from "@/features/editor/nodes/TableNode";
import { setsEqual } from "@/utils/setsEqual";

/**
 * Reuses the previous node object for every table whose inputs are unchanged.
 *
 * `buildTableNodes` rebuilds each table's `data` — fifteen fresh closures per
 * table — on *any* project change, because the Yjs layer hands back a whole
 * new `Project` on every doc update, even one editing a single unrelated
 * table. At 500 tables that is ~7500 closures allocated for a one-column
 * edit, and a `data` object whose identity always changes, so React Flow's
 * own node diffing and `TableNode`'s `memo` comparator both have to do their
 * full per-table work every time instead of bailing out on `a === b`.
 *
 * The cache turns that into "rebuild the one table that actually changed".
 * Everything the node's `data` closes over is compared: the Yjs-stable
 * `table` object by reference, `refFieldIds` by content (the Map it comes
 * from is rebuilt every project change by design), and the rest — palette,
 * permissions, the per-table slice of the field selection, and the callback
 * identities — by reference.
 */
export interface TableNodeCacheEntry {
  node: TableNodeType;
  table: Table;
  refFieldIds: Set<string>;
  selectedFieldId: string | null;
  palette: string[];
  canWrite: boolean;
  user: string;
  /** Identity of the callback bundle the node's data closes over. */
  callbacks: unknown;
}

export type TableNodeCache = Map<string, TableNodeCacheEntry>;

export function readCachedTableNode(
  cache: TableNodeCache,
  key: Omit<TableNodeCacheEntry, "node">,
  tableId: string,
): TableNodeType | null {
  const cached = cache.get(tableId);
  if (!cached) return null;
  const unchanged =
    cached.table === key.table &&
    cached.selectedFieldId === key.selectedFieldId &&
    cached.palette === key.palette &&
    cached.canWrite === key.canWrite &&
    cached.user === key.user &&
    cached.callbacks === key.callbacks &&
    setsEqual(cached.refFieldIds, key.refFieldIds);
  return unchanged ? cached.node : null;
}
