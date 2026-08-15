import { useMemo } from "react";
import * as Y from "yjs";
import { getRefsMap, type Project, type RoutingPoint } from "@athanordb/shared";
import type { RefEdgeType } from "@/features/editor/edges/RefEdge";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH, pickHandleSides, type TableBox } from "@/features/editor/edges/refGeometry";
import type { CanvasNode } from "@/types/index";

/** Builds the React Flow edge array from the live project's refs, resolving each edge's source/target handle side from the current table positions/sizes. */
export function useCanvasEdges(
  liveProject: Project | null,
  doc: Y.Doc | null,
  nodes: CanvasNode[],
  highlightLinks: boolean,
  /** The column currently under the pointer (`null` when hovering anything else) — highlighting is scoped to just that column's own relations, not the whole table's. */
  hoveredFieldId: string | null,
  palette: string[],
  onPaletteChange: (palette: string[]) => void,
  /** False for a `view` grant — the relation keeps its colour picker and waypoints hidden rather than writing changes the server discards. */
  canWrite = true,
): RefEdgeType[] {
  return useMemo(() => {
    if (!liveProject) return [];
    const tablesById = new Map(liveProject.tables.map((t) => [t.id, t]));
    const nodesById = new Map(nodes.map((n) => [n.id, n]));

    // Several refs can leave the same column (one field referenced by three
    // tables, say), and React Flow anchors them all to the identical handle —
    // so their cardinality chips would land pixel-for-pixel on top of each
    // other. Numbering them per handle here, where every ref is visible at
    // once, lets each edge offset its own chip by its slot.
    const slotCounters = new Map<string, number>();
    const takeSlot = (tableId: string, handle: string) => {
      const key = `${tableId}|${handle}`;
      const slot = slotCounters.get(key) ?? 0;
      slotCounters.set(key, slot + 1);
      return slot;
    };

    return liveProject.refs.map((ref) => {
      const fromTable = tablesById.get(ref.from.tableId);
      const toTable = tablesById.get(ref.to.tableId);

      const fromNode = nodesById.get(ref.from.tableId);
      const toNode = nodesById.get(ref.to.tableId);

      // Field ids are already globally unique (crypto.randomUUID()), so a
      // match against either endpoint is enough — no need to also check which
      // table the hovered column belongs to. A whole-table hover used to
      // light up every relation the table had; this only lights up the one
      // the pointer is actually over.
      const connectedHighlight =
        hoveredFieldId === ref.from.fieldId ||
        hoveredFieldId === ref.to.fieldId ||
        Boolean(fromNode?.selected) ||
        Boolean(toNode?.selected);

      const fromBox: TableBox = {
        x: fromNode?.position.x ?? fromTable?.position.x ?? 0,
        y: fromNode?.position.y ?? fromTable?.position.y ?? 0,
        width: fromNode?.measured?.width ?? DEFAULT_TABLE_WIDTH,
        height: fromNode?.measured?.height ?? DEFAULT_TABLE_HEIGHT,
      };
      const toBox: TableBox = {
        x: toNode?.position.x ?? toTable?.position.x ?? 0,
        y: toNode?.position.y ?? toTable?.position.y ?? 0,
        width: toNode?.measured?.width ?? DEFAULT_TABLE_WIDTH,
        height: toNode?.measured?.height ?? DEFAULT_TABLE_HEIGHT,
      };

      const isSelfRef = ref.from.tableId === ref.to.tableId;
      const { fromSide, toSide } = pickHandleSides(fromBox, toBox);

      const fromCompact = fromTable?.detailLevel === "compact";
      const toCompact = toTable?.detailLevel === "compact";

      let sourceHandle: string;
      let targetHandle: string;

      if (isSelfRef) {
        sourceHandle = fromCompact ? "header-right-source" : `${ref.from.fieldId}-right-source`;
        targetHandle = toCompact ? "header-right-target" : `${ref.to.fieldId}-right-target`;
      } else {
        sourceHandle = fromCompact ? `header-${fromSide}-source` : `${ref.from.fieldId}-${fromSide}-source`;
        targetHandle = toCompact ? `header-${toSide}-target` : `${ref.to.fieldId}-${toSide}-target`;
      }

      return {
        id: ref.id,
        source: ref.from.tableId,
        target: ref.to.tableId,
        sourceHandle,
        targetHandle,
        type: "ref",
        data: {
          cardinality: ref.cardinality,
          sourceSlot: takeSlot(ref.from.tableId, sourceHandle),
          targetSlot: takeSlot(ref.to.tableId, targetHandle),
          routingPoints: ref.routingPoints,
          highlightLinks,
          connectedHighlight,
          color: ref.style?.color,
          palette,
          onPaletteChange,
          onColorChange: (color: string | undefined) => {
            if (!doc || !canWrite) return;
            const refs = getRefsMap(doc);
            const current = refs.get(ref.id);
            if (current) refs.set(ref.id, { ...current, style: { ...current.style, color } });
          },
          onRoutingPointsChange: (routingPoints: RoutingPoint[] | undefined) => {
            if (!doc || !canWrite) return;
            const refs = getRefsMap(doc);
            const current = refs.get(ref.id);
            if (current) refs.set(ref.id, { ...current, routingPoints });
          },
          onDeleteRef: !canWrite ? undefined : () => {
            if (!doc) return;
            const refs = getRefsMap(doc);
            refs.delete(ref.id);
          },
        },
        // No `markerEnd`: the arrowhead is drawn inside `RefEdge` so it can
        // follow the stroke's live colour and opacity, and hold a constant
        // screen size instead of scaling with the (zoom-compensated) width.
      };
    });
  }, [liveProject, doc, nodes, highlightLinks, hoveredFieldId, palette, onPaletteChange, canWrite]);
}
