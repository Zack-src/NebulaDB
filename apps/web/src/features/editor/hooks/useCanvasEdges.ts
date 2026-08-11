import { useMemo } from "react";
import * as Y from "yjs";
import { MarkerType } from "@xyflow/react";
import { getRefsMap, type Project, type RoutingPoint } from "@athanordb/shared";
import { CARDINALITY_STYLE, type RefEdgeType } from "@/features/editor/edges/RefEdge";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH, pickHandleSides, type TableBox } from "@/features/editor/edges/refGeometry";
import type { CanvasNode } from "@/types/index";

/** Builds the React Flow edge array from the live project's refs, resolving each edge's source/target handle side from the current table positions/sizes. */
export function useCanvasEdges(
  liveProject: Project | null,
  doc: Y.Doc | null,
  nodes: CanvasNode[],
  highlightLinks: boolean,
  hoveredTableId: string | null,
  palette: string[],
  onPaletteChange: (palette: string[]) => void,
): RefEdgeType[] {
  return useMemo(() => {
    if (!liveProject) return [];
    const tablesById = new Map(liveProject.tables.map((t) => [t.id, t]));
    const nodesById = new Map(nodes.map((n) => [n.id, n]));

    return liveProject.refs.map((ref) => {
      const fromTable = tablesById.get(ref.from.tableId);
      const toTable = tablesById.get(ref.to.tableId);

      const fromNode = nodesById.get(ref.from.tableId);
      const toNode = nodesById.get(ref.to.tableId);

      const connectedHighlight =
        hoveredTableId === ref.from.tableId ||
        hoveredTableId === ref.to.tableId ||
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
          routingPoints: ref.routingPoints,
          highlightLinks,
          connectedHighlight,
          color: ref.style?.color,
          palette,
          onPaletteChange,
          onColorChange: (color: string | undefined) => {
            if (!doc) return;
            const refs = getRefsMap(doc);
            const current = refs.get(ref.id);
            if (current) refs.set(ref.id, { ...current, style: { ...current.style, color } });
          },
          onRoutingPointsChange: (routingPoints: RoutingPoint[] | undefined) => {
            if (!doc) return;
            const refs = getRefsMap(doc);
            const current = refs.get(ref.id);
            if (current) refs.set(ref.id, { ...current, routingPoints });
          },
          onDeleteRef: () => {
            if (!doc) return;
            const refs = getRefsMap(doc);
            refs.delete(ref.id);
          },
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: ref.style?.color ?? CARDINALITY_STYLE[ref.cardinality].stroke },
      };
    });
  }, [liveProject, doc, nodes, highlightLinks, hoveredTableId, palette, onPaletteChange]);
}
