import { useCallback, useMemo, useState } from "react";
import * as Y from "yjs";
import { getMetaMap, type Project } from "@athanordb/shared";
import { DEFAULT_PALETTE } from "@/components/inputs/ColorSwatchPicker";
import type { CanvasNode } from "@/types/index";
import { buildZoneNodes } from "./buildZoneNodes";
import { buildTableNodes } from "./buildTableNodes";
import { buildStickyNodes } from "./buildStickyNodes";
import { buildEnumNodes } from "./buildEnumNodes";
import { buildTableGroupNodes } from "./buildTableGroupNodes";
import { useSelectionPreservingNodes } from "./useSelectionPreservingNodes";
import { useNodesChangeHandler } from "./useNodesChangeHandler";
import type { TableNodeCache } from "./tableNodeCache";
import { time } from "@/utils/perfMonitor";

/**
 * Builds the React Flow node array (zones, tables, sticky notes — in that
 * paint order so tables/notes drag on top of zones) from the live Yjs
 * project, wiring each node's `data` callbacks straight to doc mutations.
 * Also owns the local, controlled node state React Flow needs to show live
 * drag position: `builtNodes` (source of truth from the doc) only updates
 * once a drag commits, so without a local copy the node would visually snap
 * around mid-drag.
 *
 * Rebuilds every table's `data` object (and its callback closures) from
 * scratch on any project/doc/selection change — including one editing a
 * single unrelated table, since `liveProject` is a fresh object on every doc
 * update. That's deliberately not fought here with a cross-render cache:
 * `TableNode`'s own `memo` comparator (see `TableNode.tsx`) is what actually
 * absorbs this — it compares the *meaningful* parts of `data` (the `table`
 * object, which the Yjs layer already keeps reference-stable per id; and
 * `refFieldIds`, compared by content) rather than the wrapping `data` object
 * itself, so a fresh object per rebuild doesn't defeat it.
 */
export function useCanvasNodes(
  liveProject: Project | null,
  doc: Y.Doc | null,
  refFieldIdsByTable: Map<string, Set<string>>,
  user: string,
  onGoToDbml: (tableName: string) => void,
  /** Fires when the pointer enters/leaves a specific column row (`null` on leave) — narrows link highlighting to that column instead of the whole table. */
  onFieldHoverChange: (fieldId: string | null) => void,
  /** Fires when the pointer enters/leaves a table (`null` on leave) — highlights all relations of the table. */
  onTableHoverChange: (tableId: string | null) => void,
  selectedFieldId: string | null,
  onSelectField: (fieldId: string | null) => void,
  /** False for a `view` grant: nodes still render and select, but nothing they do reaches the document. */
  canWrite = true,
) {
  // Survives every rebuild: it is the thing that makes a rebuild cheap. Held
  // in state (never set again) rather than a ref, so nothing reads a ref
  // during render.
  const [tableNodeCache] = useState<TableNodeCache>(() => new Map());
  // Stable identity, so it can be part of the cache key rather than
  // invalidating every table on every rebuild.
  const onPaletteChange = useCallback(
    (next: string[]) => {
      if (doc) getMetaMap(doc).set("paletteColors", next);
    },
    [doc],
  );

  const builtNodes: CanvasNode[] = useMemo(() => {
    if (!liveProject || !doc) return [];

    const palette = liveProject.paletteColors ?? DEFAULT_PALETTE;

    return time("canvas.buildNodes", () => [
      ...buildZoneNodes(liveProject.zones, doc, palette, onPaletteChange, canWrite),
      ...buildTableNodes(
        liveProject.tables,
        doc,
        refFieldIdsByTable,
        user,
        palette,
        onPaletteChange,
        onGoToDbml,
        onFieldHoverChange,
        onTableHoverChange,
        selectedFieldId,
        onSelectField,
        canWrite,
        tableNodeCache,
      ),
      ...buildStickyNodes(liveProject.stickyNotes, doc, palette, onPaletteChange, canWrite),
      ...buildEnumNodes(liveProject.enums, doc, canWrite),
      ...buildTableGroupNodes(liveProject.tableGroups, liveProject.tables, doc, canWrite),
    ]);
  }, [
    liveProject,
    doc,
    refFieldIdsByTable,
    user,
    onGoToDbml,
    onFieldHoverChange,
    onTableHoverChange,
    selectedFieldId,
    onSelectField,
    canWrite,
    onPaletteChange,
    tableNodeCache,
  ]);

  const [nodes, setNodes] = useSelectionPreservingNodes(builtNodes);
  // A null doc makes every persist branch in the handler a no-op, so drags and
  // deletions stay local instead of being written and silently dropped.
  const { onNodesChange, dragging } = useNodesChangeHandler(nodes, setNodes, canWrite ? doc : null);

  return { nodes, onNodesChange, dragging };
}
