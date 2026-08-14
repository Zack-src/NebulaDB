import { useMemo } from "react";
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

/**
 * Builds the React Flow node array (zones, tables, sticky notes — in that
 * paint order so tables/notes drag on top of zones) from the live Yjs
 * project, wiring each node's `data` callbacks straight to doc mutations.
 * Also owns the local, controlled node state React Flow needs to show live
 * drag position: `builtNodes` (source of truth from the doc) only updates
 * once a drag commits, so without a local copy the node would visually snap
 * around mid-drag.
 */
export function useCanvasNodes(
  liveProject: Project | null,
  doc: Y.Doc | null,
  refFieldIdsByTable: Map<string, Set<string>>,
  user: string,
  highlightLinks: boolean,
  onGoToDbml: (tableName: string) => void,
  /** False for a `view` grant: nodes still render and select, but nothing they do reaches the document. */
  canWrite = true,
) {
  const builtNodes: CanvasNode[] = useMemo(() => {
    if (!liveProject || !doc) return [];

    const palette = liveProject.paletteColors ?? DEFAULT_PALETTE;
    const onPaletteChange = (next: string[]) => {
      getMetaMap(doc).set("paletteColors", next);
    };

    return [
      ...buildZoneNodes(liveProject.zones, doc, palette, onPaletteChange, canWrite),
      ...buildTableNodes(liveProject.tables, doc, refFieldIdsByTable, user, highlightLinks, palette, onPaletteChange, onGoToDbml, canWrite),
      ...buildStickyNodes(liveProject.stickyNotes, doc, palette, onPaletteChange, canWrite),
      ...buildEnumNodes(liveProject.enums, doc, canWrite),
      ...buildTableGroupNodes(liveProject.tableGroups, liveProject.tables, doc, canWrite),
    ];
  }, [liveProject, doc, refFieldIdsByTable, user, highlightLinks, onGoToDbml, canWrite]);

  const [nodes, setNodes] = useSelectionPreservingNodes(builtNodes);
  // A null doc makes every persist branch in the handler a no-op, so drags and
  // deletions stay local instead of being written and silently dropped.
  const onNodesChange = useNodesChangeHandler(nodes, setNodes, canWrite ? doc : null);

  return { nodes, onNodesChange };
}
