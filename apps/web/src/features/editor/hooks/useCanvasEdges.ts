import { useMemo } from "react";
import * as Y from "yjs";
import { getRefsMap, type Project, type RefCardinality, type RoutingPoint } from "@athanordb/shared";
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
  /** The table currently under the pointer (`null` when not hovering a table) — highlights all relations of the table unless a specific column is hovered/selected. */
  hoveredTableId: string | null,
  /** The column currently selected (`null` when no column is selected) — keeps its relations highlighted even after mouse leaves. */
  selectedFieldId: string | null,
  /** The edge currently selected (`null` when no edge is selected) — keeps its editing toolbar and waypoints visible. */
  selectedEdgeId: string | null,
  onSelectEdge?: (edgeId: string | null) => void,
  palette: string[] = [],
  onPaletteChange?: (palette: string[]) => void,
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

    // eslint-disable-next-line complexity -- resolves each ref's hover/selection highlight, handle sides and per-slot offset from live table/node state in one pass; splitting the per-edge derivation into helpers would scatter the Yjs-backed callbacks it closes over without a test in place to catch a regression
    return liveProject.refs.map((ref) => {
      const fromTable = tablesById.get(ref.from.tableId);
      const toTable = tablesById.get(ref.to.tableId);

      const fromNode = nodesById.get(ref.from.tableId);
      const toNode = nodesById.get(ref.to.tableId);

      const isFieldHovered = Boolean(
        hoveredFieldId && (hoveredFieldId === ref.from.fieldId || hoveredFieldId === ref.to.fieldId),
      );
      const isFieldSelected = Boolean(
        selectedFieldId && (selectedFieldId === ref.from.fieldId || selectedFieldId === ref.to.fieldId),
      );
      const isTableHovered = Boolean(
        !hoveredFieldId && !selectedFieldId && hoveredTableId && (hoveredTableId === ref.from.tableId || hoveredTableId === ref.to.tableId),
      );
      const isTableSelected =
        !selectedFieldId && (Boolean(fromNode?.selected) || Boolean(toNode?.selected));

      const isEdgeSelected = ref.id === selectedEdgeId;
      const connectedHighlight = isFieldHovered || isFieldSelected || isTableHovered || isTableSelected || isEdgeSelected;

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
        selected: isEdgeSelected,
        data: {
          cardinality: ref.cardinality,
          sourceSlot: takeSlot(ref.from.tableId, sourceHandle),
          targetSlot: takeSlot(ref.to.tableId, targetHandle),
          routingPoints: ref.routingPoints,
          highlightLinks,
          connectedHighlight,
          color: ref.style?.color,
          palette,
          onPaletteChange: onPaletteChange ?? (() => {}),
          onSelectEdge,
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
          onCardinalityChange: (cardinality: RefCardinality) => {
            if (!doc || !canWrite) return;
            const refs = getRefsMap(doc);
            const current = refs.get(ref.id);
            if (current) refs.set(ref.id, { ...current, cardinality });
          },
          onDeleteRef: !canWrite ? undefined : () => {
            if (!doc) return;
            const refs = getRefsMap(doc);
            refs.delete(ref.id);
            if (selectedEdgeId === ref.id) onSelectEdge?.(null);
          },
        },
        // No `markerEnd`: the arrowhead is drawn inside `RefEdge` so it can
        // follow the stroke's live colour and opacity, and hold a constant
        // screen size instead of scaling with the (zoom-compensated) width.
      };
    });
  }, [liveProject, doc, nodes, highlightLinks, hoveredFieldId, hoveredTableId, selectedFieldId, selectedEdgeId, onSelectEdge, palette, onPaletteChange, canWrite]);
}
