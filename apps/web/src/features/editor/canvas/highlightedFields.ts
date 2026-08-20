import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";

/**
 * "Which of this table's columns sit on a highlighted relation", computed
 * **once per edge change** for the whole canvas instead of once per table.
 *
 * Every `TableNode` used to answer that question for itself with its own
 * `useStore` selector walking the entire edge array. Zustand runs every
 * subscriber's selector on *every* store mutation — including each pan/zoom
 * transform tick, which has nothing to do with edges — so the canvas paid
 * O(tables × edges) per store update: measured at 1.5 million selector
 * invocations (~1.5s of pure selector time, inside a 7.3s freeze) for a
 * single "highlight links" toggle on a 500-table schema.
 *
 * Here one subscriber selects `state.edges` (a reference comparison, so it
 * only recomputes when the edge array itself is replaced), walks it once, and
 * publishes a per-table key. Each table then reads its own key by id: O(1).
 *
 * The key is a joined string on purpose — it compares with `===`, so a table
 * whose highlighted columns didn't change doesn't re-render even though the
 * map behind it was rebuilt.
 */

type HighlightedFieldsMap = Map<string, string>;

let current: HighlightedFieldsMap = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: HighlightedFieldsMap): void {
  current = next;
  for (const listener of listeners) listener();
}

/** `fieldId-left-source` -> `fieldId`. */
const HANDLE_SUFFIX = /-(left|right)-(source|target)$/;
const stripHandleSuffix = (handle: string) => handle.replace(HANDLE_SUFFIX, "");

const edgesSelector = (state: ReactFlowState) => state.edges;

function computeHighlightedFields(edges: ReactFlowState["edges"]): HighlightedFieldsMap {
  const byTable = new Map<string, string[]>();
  const push = (tableId: string, handle: string) => {
    const list = byTable.get(tableId);
    if (list) list.push(stripHandleSuffix(handle));
    else byTable.set(tableId, [stripHandleSuffix(handle)]);
  };
  for (const edge of edges) {
    if (!edge.selected && !(edge.data as { connectedHighlight?: boolean } | undefined)?.connectedHighlight) continue;
    if (edge.sourceHandle) push(edge.source, edge.sourceHandle);
    if (edge.targetHandle) push(edge.target, edge.targetHandle);
  }
  const keys: HighlightedFieldsMap = new Map();
  for (const [tableId, fieldIds] of byTable) keys.set(tableId, fieldIds.sort().join("|"));
  return keys;
}

/**
 * Publishes the map for the whole canvas. Mounted once, inside the
 * `ReactFlowProvider` (see `CanvasArea`).
 */
export function useHighlightedFieldsPublisher(): void {
  const edges = useStore(edgesSelector);
  useEffect(() => {
    publish(computeHighlightedFields(edges));
  }, [edges]);
  // Nothing on the canvas should keep a stale highlight if it unmounts
  // mid-gesture (view switch, project close).
  useEffect(() => () => publish(new Map()), []);
}

/** This table's highlighted columns, as a `|`-joined key. */
export function useHighlightedFieldKey(tableId: string): string {
  const getSnapshot = useCallback(() => current.get(tableId) ?? "", [tableId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
