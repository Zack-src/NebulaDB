import { useEffect, useMemo, useRef } from "react";
import * as Y from "yjs";
import { getRefsMap, type Project, type RefAction, type RefCardinality, type RoutingPoint } from "@athanordb/shared";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import type { RefEdgeData, RefEdgeType } from "@/features/editor/edges/RefEdge";
import {
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  pickHandleSides,
  type TableBox,
} from "@/features/editor/edges/refGeometry";
import type { CanvasNode } from "@/types/index";
import { time } from "@/utils/perfMonitor";
import { useIsSelecting } from "@/features/editor/canvas/selectionDragState";

const EMPTY_ISSUES_BY_REF: Map<string, ValidationIssue[]> = new Map();
const EMPTY_SELECTED_TABLE_IDS: string[] = [];

/**
 * `nodes` by geometry alone: same node array reference until some node's
 * `id`/`position`/`measured` size actually changes — a plain (de)selection or
 * hover, which replaces the whole `nodes` array reference without moving or
 * resizing anything, leaves this returning the *previous* array untouched.
 *
 * `useCanvasEdges` used to take the raw `nodes` array as a dependency for
 * exactly this geometry, which meant clicking to select a table (or even just
 * hovering one, before that was split out — see the highlight overlay below)
 * rebuilt every single edge's data object and its six closures from scratch,
 * on a canvas with hundreds of tables and thousands of relations that's the
 * "select a table, everything freezes for a moment" bug: an O(refs) rebuild
 * on every click/hover, independent of table count or viewport.
 *
 * Frozen entirely during a drag for the same reason `geometryNodesRef` was:
 * `nodes` is replaced on every drag frame, and geometry only needs to catch
 * up once, on drop. A selection-box drag replaces `nodes` on every
 * pointer-move tick too, same as a position drag — but no position changed,
 * only which tables are selected, so it's frozen here for the same reason.
 *
 * Render-phase ref read/write, same pattern (and same justification) as the
 * original `geometryNodesRef` this replaces: idempotent given this render's
 * own inputs, and has to be settled before this same render's `useMemo`
 * below reads it — an effect (a render later) would be too late for the very
 * first frame after a real geometry change.
 */
function useGeometryStableNodes(nodes: CanvasNode[], dragging: boolean, selecting: boolean): CanvasNode[] {
  const stableRef = useRef(nodes);
  const geoKeyRef = useRef("");
  // eslint-disable-next-line react-hooks/refs -- see doc comment above
  if (dragging || selecting) return stableRef.current;

  let key = "";
  for (const n of nodes) key += `${n.id}:${n.position.x},${n.position.y},${n.measured?.width ?? ""},${n.measured?.height ?? ""};`;
  // eslint-disable-next-line react-hooks/refs -- see doc comment above
  const geoChanged = key !== geoKeyRef.current || stableRef.current.length !== nodes.length;
  if (geoChanged) {
    // eslint-disable-next-line react-hooks/refs -- see doc comment above
    geoKeyRef.current = key;
    // eslint-disable-next-line react-hooks/refs -- see doc comment above
    stableRef.current = nodes;
  }
  // eslint-disable-next-line react-hooks/refs -- see doc comment above
  return stableRef.current;
}

/** Everything about a ref's highlight state that isn't geometry — recomputed far more often (every hover, every select) than the edge itself, so it's kept out of the heavy build below on purpose. */
interface EdgeHighlightFlags {
  selected: boolean;
  connectedHighlight: boolean;
  highlightLinks: boolean;
}

function computeHighlightFlags(
  edge: RefEdgeType,
  highlightLinks: boolean,
  hoveredFieldId: string | null,
  hoveredTableId: string | null,
  selectedFieldId: string | null,
  selectedEdgeId: string | null,
  selectedTableIds: Set<string>,
): EdgeHighlightFlags {
  const fromFieldId = edge.data?.fromFieldId;
  const toFieldId = edge.data?.toFieldId;
  const isFieldHovered = Boolean(hoveredFieldId && (hoveredFieldId === fromFieldId || hoveredFieldId === toFieldId));
  const isFieldSelected = Boolean(
    selectedFieldId && (selectedFieldId === fromFieldId || selectedFieldId === toFieldId),
  );
  const isTableHovered = Boolean(
    !hoveredFieldId &&
    !selectedFieldId &&
    hoveredTableId &&
    (hoveredTableId === edge.source || hoveredTableId === edge.target),
  );
  const isTableSelected = !selectedFieldId && (selectedTableIds.has(edge.source) || selectedTableIds.has(edge.target));
  const isEdgeSelected = edge.id === selectedEdgeId;
  return {
    selected: isEdgeSelected,
    connectedHighlight: isFieldHovered || isFieldSelected || isTableHovered || isTableSelected || isEdgeSelected,
    highlightLinks,
  };
}

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
  /**
   * True while a node is being dragged. Held only to freeze geometry (see
   * `useGeometryStableNodes`) — the heavy edge build itself no longer takes
   * `nodes` as a direct dependency. The nodes array would otherwise be
   * replaced on every drag frame, and the geometry pass takes it as a
   * dependency (endpoint positions decide which side of each table a
   * relation leaves from) — so a 500-table schema would rebuild handle sides
   * for all ~500 edges sixty times a second for one table in flight. Nothing
   * visible is lost by holding still: React Flow anchors each edge to its
   * handle's live position, so the line follows the dragged table either
   * way; only the *choice* of left-vs-right handle waits for the drop.
   */
  dragging = false,
  /** Per-ref validation issues, from `ProjectEditor`'s `useMemo(() => validateProject(liveProject), ...)`. */
  issuesByRef: Map<string, ValidationIssue[]> = EMPTY_ISSUES_BY_REF,
  /** The canvas-wide "show validation issues" toggle — see `CanvasToolbar`. */
  showValidationIssues = true,
  /** Ids of the currently-selected table nodes — see `ProjectEditor`'s `selectedTableIds`. Only used for highlight, kept separate from `nodes` so selecting a table doesn't also invalidate the heavy build below. */
  selectedTableIds: string[] = EMPTY_SELECTED_TABLE_IDS,
): RefEdgeType[] {
  // A selection-box drag replaces `nodes` on every pointer-move tick too,
  // same as a position drag — but no position changed, only which tables are
  // selected. Frozen here for the same reason `dragging` already is: this
  // feeds the *geometry* half below (handle sides, from table
  // positions/sizes), which a selection genuinely cannot change. See
  // `selectionDragState.ts`.
  const selecting = useIsSelecting();
  const geometryNodes = useGeometryStableNodes(nodes, dragging, selecting);
  // Read by `onDeleteRef` below, which needs the *current* selection at click
  // time without forcing the heavy build to rebuild every time selection
  // moves — a plain closure over the parameter would go stale the moment
  // `selectedEdgeId` was pulled out of that memo's dependency array.
  const selectedEdgeIdRef = useRef(selectedEdgeId);
  // eslint-disable-next-line react-hooks/refs -- idempotent render-phase write, read back only from an event handler later
  selectedEdgeIdRef.current = selectedEdgeId;

  // The heavy build: one Map per table/node, six closures and a slot-offset
  // counter per ref. Deliberately blind to hover/selection/highlight state —
  // see `useGeometryStableNodes` and the overlay pass below for why.
  const baseEdges = useMemo(() => {
    if (!liveProject) return [];
    const project = liveProject;
    return time("canvas.buildEdges", () => buildBaseEdges());

    function buildBaseEdges(): RefEdgeType[] {
      const tablesById = new Map(project.tables.map((t) => [t.id, t]));
      const nodesById = new Map(geometryNodes.map((n) => [n.id, n]));

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

      // eslint-disable-next-line complexity -- resolves each ref's geometry (handle sides, self-ref/compact special-casing, slot offset) and every doc-mutating closure in one pass; splitting the per-edge derivation into helpers would scatter the Yjs-backed callbacks it closes over without a test in place to catch a regression
      return project.refs.map((ref) => {
        const fromTable = tablesById.get(ref.from.tableId);
        const toTable = tablesById.get(ref.to.tableId);

        const fromNode = nodesById.get(ref.from.tableId);
        const toNode = nodesById.get(ref.to.tableId);

        const refIssues = showValidationIssues ? issuesByRef.get(ref.id) : undefined;

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
          selected: false,
          data: {
            cardinality: ref.cardinality,
            onDelete: ref.onDelete,
            onUpdate: ref.onUpdate,
            sourceSlot: takeSlot(ref.from.tableId, sourceHandle),
            targetSlot: takeSlot(ref.to.tableId, targetHandle),
            routingPoints: ref.routingPoints,
            // Overwritten every render by the highlight overlay below — starts
            // `false` here so a base edge is never accidentally rendered
            // highlighted before the overlay runs.
            highlightLinks: false,
            connectedHighlight: false,
            // Kept for the highlight overlay's field-level hover/selection
            // check, without which it would have no way to test a ref against
            // `hoveredFieldId`/`selectedFieldId` without re-deriving them from
            // `sourceHandle`/`targetHandle` (lossy in compact mode).
            fromFieldId: ref.from.fieldId,
            toFieldId: ref.to.fieldId,
            hasIssue: Boolean(refIssues?.length),
            issueMessages: refIssues?.map((issue) => issue.message),
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
            onDeleteActionChange: !canWrite
              ? undefined
              : (onDelete: RefAction | undefined) => {
                  if (!doc) return;
                  const refs = getRefsMap(doc);
                  const current = refs.get(ref.id);
                  if (current) refs.set(ref.id, { ...current, onDelete });
                },
            onUpdateActionChange: !canWrite
              ? undefined
              : (onUpdate: RefAction | undefined) => {
                  if (!doc) return;
                  const refs = getRefsMap(doc);
                  const current = refs.get(ref.id);
                  if (current) refs.set(ref.id, { ...current, onUpdate });
                },
            // Swaps which table/field is "from" and which is "to" — the arrow
            // (and, for one-to-many, which end reads "1" vs "n") flips to match,
            // with no change to `cardinality` itself: one-to-one and many-to-many
            // read the same from either direction, and one-to-many's "1"/"n"
            // labels are derived from from/to position already, so swapping the
            // endpoints is the whole fix.
            onReverseDirection: !canWrite
              ? undefined
              : () => {
                  if (!doc) return;
                  const refs = getRefsMap(doc);
                  const current = refs.get(ref.id);
                  if (current) refs.set(ref.id, { ...current, from: current.to, to: current.from });
                },
            onDeleteRef: !canWrite
              ? undefined
              : () => {
                  if (!doc) return;
                  const refs = getRefsMap(doc);
                  refs.delete(ref.id);
                  if (selectedEdgeIdRef.current === ref.id) onSelectEdge?.(null);
                },
          },
          // No `markerEnd`: the arrowhead is drawn inside `RefEdge` so it can
          // follow the stroke's live colour and opacity, and hold a constant
          // screen size instead of scaling with the (zoom-compensated) width.
        };
      });
    }
  }, [
    liveProject,
    doc,
    geometryNodes,
    palette,
    onPaletteChange,
    onSelectEdge,
    canWrite,
    issuesByRef,
    showValidationIssues,
  ]);

  // The cheap pass: no Maps-of-tables, no per-ref closures, no handle-string
  // building — just five primitive comparisons per ref. Runs on every hover
  // and (de)selection, which is the whole point: that used to mean
  // `buildBaseEdges` above, now it means this instead.
  //
  // Reuses the previous edge object for any ref whose highlight flags didn't
  // actually change (same trick as `useSelectionPreservingNodes`), so a hover
  // over one table doesn't hand React Flow — and every `RefEdge`'s `memo`
  // comparator — a fresh object for the other few thousand edges too.
  // Render-phase ref read/write, same idempotent pattern as
  // `useGeometryStableNodes`/the original `geometryNodesRef` — has to be
  // settled synchronously so the very same `useMemo` call below can read it
  // back.
  const overlayRef = useRef<Map<string, { flags: EdgeHighlightFlags; edge: RefEdgeType }>>(new Map());
  return useMemo(() => {
    const selectedTableIdSet = new Set(selectedTableIds);
    const nextOverlay = new Map<string, { flags: EdgeHighlightFlags; edge: RefEdgeType }>();
    // eslint-disable-next-line react-hooks/refs -- idempotent render-phase read of overlayRef inside this callback, see doc comment above
    const result = baseEdges.map((edge) => {
      const flags = computeHighlightFlags(
        edge,
        highlightLinks,
        hoveredFieldId,
        hoveredTableId,
        selectedFieldId,
        selectedEdgeId,
        selectedTableIdSet,
      );
      const prev = overlayRef.current.get(edge.id);
      if (
        prev &&
        prev.edge.data === edge.data &&
        prev.flags.selected === flags.selected &&
        prev.flags.connectedHighlight === flags.connectedHighlight &&
        prev.flags.highlightLinks === flags.highlightLinks
      ) {
        nextOverlay.set(edge.id, prev);
        return prev.edge;
      }
      const merged: RefEdgeType = {
        ...edge,
        selected: flags.selected,
        data: {
          ...(edge.data as RefEdgeData),
          connectedHighlight: flags.connectedHighlight,
          highlightLinks: flags.highlightLinks,
        },
      };
      nextOverlay.set(edge.id, { flags, edge: merged });
      return merged;
    });
    // eslint-disable-next-line react-hooks/refs -- idempotent render-phase write, see doc comment above
    overlayRef.current = nextOverlay;
    return result;
  }, [baseEdges, highlightLinks, hoveredFieldId, hoveredTableId, selectedFieldId, selectedEdgeId, selectedTableIds]);
}
