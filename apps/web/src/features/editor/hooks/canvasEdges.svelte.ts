import * as Y from "yjs";
import {
  getRefsMap,
  type Project,
  type Ref,
  type RefAction,
  type RefCardinality,
  type RoutingPoint,
} from "@athanordb/shared";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import type { RefEdgeData, RefEdgeType } from "@/features/editor/edges/refEdgeTypes";
import {
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  pickHandleSides,
  type TableBox,
} from "@/features/editor/edges/refGeometry";
import { selectionDrag } from "@/features/editor/canvas/selectionDragState.svelte";
import type { CanvasNode } from "@/types/index";
import { time } from "@/utils/perfMonitor";

/** A table's box for side picking: its live node when rendered, the stored position (and a default size) until it has been measured. */
function tableBoxOf(node: CanvasNode | undefined, table: { position: { x: number; y: number } } | undefined): TableBox {
  return {
    x: node?.position.x ?? table?.position.x ?? 0,
    y: node?.position.y ?? table?.position.y ?? 0,
    width: node?.measured?.width ?? DEFAULT_TABLE_WIDTH,
    height: node?.measured?.height ?? DEFAULT_TABLE_HEIGHT,
  };
}

export interface CanvasEdgesInput {
  liveProject: () => Project | null;
  doc: () => Y.Doc | null;
  nodes: () => CanvasNode[];
  highlightLinks: () => boolean;
  /** The column currently under the pointer (`null` when hovering anything else) — highlighting is scoped to just that column's own relations, not the whole table's. */
  hoveredFieldId: () => string | null;
  /** The table currently under the pointer (`null` when not hovering a table) — highlights all relations of the table unless a specific column is hovered/selected. */
  hoveredTableId: () => string | null;
  /** The column currently selected (`null` when no column is selected) — keeps its relations highlighted even after the mouse leaves. */
  selectedFieldId: () => string | null;
  /** The edge currently selected (`null` when no edge is selected) — keeps its editing toolbar and waypoints visible. */
  selectedEdgeId: () => string | null;
  onSelectEdge: (edgeId: string | null) => void;
  palette: () => string[];
  onPaletteChange: (palette: string[]) => void;
  /** False for a `view` grant — the relation keeps its colour picker and waypoints hidden rather than writing changes the server discards. */
  canWrite: () => boolean;
  /**
   * True while a node is being dragged. Held only to freeze geometry (see
   * `geometryNodes`): the nodes array is replaced on every drag frame, and the
   * geometry pass takes it as a dependency (endpoint positions decide which
   * side of each table a relation leaves from) — so a 500-table schema would
   * rebuild handle sides for all ~500 edges sixty times a second for one table
   * in flight. Nothing visible is lost by holding still: the flow anchors each
   * edge to its handle's live position, so the line follows the dragged table
   * either way; only the *choice* of left-vs-right handle waits for the drop.
   */
  dragging: () => boolean;
  /** Per-ref validation issues, from `ProjectEditor`'s `validateProject(liveProject)`. */
  issuesByRef: () => Map<string, ValidationIssue[]>;
  /** The canvas-wide "show validation issues" toggle — see `CanvasToolbar`. */
  showValidationIssues: () => boolean;
  /** Ids of the currently-selected table nodes. Only used for highlight, kept separate from `nodes` so selecting a table doesn't also invalidate the heavy build below. */
  selectedTableIds: () => string[];
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
  const isFieldSelected = Boolean(selectedFieldId && (selectedFieldId === fromFieldId || selectedFieldId === toFieldId));
  const isTableHovered = Boolean(
    !hoveredFieldId && !selectedFieldId && hoveredTableId && (hoveredTableId === edge.source || hoveredTableId === edge.target),
  );
  const isTableSelected = !selectedFieldId && (selectedTableIds.has(edge.source) || selectedTableIds.has(edge.target));
  const isEdgeSelected = edge.id === selectedEdgeId;
  return {
    selected: isEdgeSelected,
    connectedHighlight: isFieldHovered || isFieldSelected || isTableHovered || isTableSelected || isEdgeSelected,
    highlightLinks,
  };
}

interface OverlayEntry {
  flags: EdgeHighlightFlags;
  /**
   * The base edge's `data` this entry was built from. The merged edge carries
   * its own copy of `data` (with the flags folded in), so it is this — not the
   * merged edge's data — that tells whether the heavy pass rebuilt the ref.
   */
  base: RefEdgeType["data"];
  edge: RefEdgeType;
}

/**
 * Builds the flow's edge array from the live project's refs, in two passes:
 *
 *  - a **heavy geometry build** — one Map per table/node, six closures and a
 *    slot-offset counter per ref, handle sides resolved from table
 *    positions/sizes — deliberately blind to hover/selection/highlight state;
 *  - a **cheap highlight overlay** — five primitive comparisons per ref, run
 *    on every hover and (de)selection, reusing the previous edge object for
 *    any ref whose flags didn't change.
 */
export class CanvasEdgesState {
  private readonly input: CanvasEdgesInput;
  private stableNodes: CanvasNode[] = [];
  private geometryKey = "";
  private overlay = new Map<string, OverlayEntry>();

  /**
   * `nodes` by geometry alone: same array reference until some node's
   * `id`/`position`/`measured` size actually changes — a plain (de)selection
   * or hover, which replaces the whole `nodes` array reference without moving
   * or resizing anything, leaves this returning the *previous* array.
   *
   * Taking the raw `nodes` as a dependency for this geometry meant clicking to
   * select a table rebuilt every edge's data object and its six closures from
   * scratch — on a canvas with hundreds of tables and thousands of relations
   * that was "select a table, everything freezes for a moment".
   *
   * Frozen entirely during a drag or a lasso: `nodes` is replaced on every
   * frame of both, and geometry only needs to catch up once, on drop (a lasso
   * never moves anything at all).
   */
  private readonly geometryNodes = $derived.by((): CanvasNode[] => {
    const nodes = this.input.nodes();
    if (this.input.dragging() || selectionDrag.selecting) return this.stableNodes;

    let key = "";
    for (const n of nodes) key += `${n.id}:${n.position.x},${n.position.y},${n.measured?.width ?? ""},${n.measured?.height ?? ""};`;
    if (key !== this.geometryKey || this.stableNodes.length !== nodes.length) {
      this.geometryKey = key;
      this.stableNodes = nodes;
    }
    return this.stableNodes;
  });

  private readonly baseEdges = $derived.by((): RefEdgeType[] => {
    const project = this.input.liveProject();
    if (!project) return [];
    const geometryNodes = this.geometryNodes;
    const doc = this.input.doc();
    const palette = this.input.palette();
    const onPaletteChange = this.input.onPaletteChange;
    const onSelectEdge = this.input.onSelectEdge;
    const canWrite = this.input.canWrite();
    const issuesByRef = this.input.issuesByRef();
    const showValidationIssues = this.input.showValidationIssues();
    const selectedEdgeId = this.input.selectedEdgeId;

    return time("canvas.buildEdges", () => {
      const tablesById = new Map(project.tables.map((t) => [t.id, t]));
      const nodesById = new Map(geometryNodes.map((n) => [n.id, n]));

      // Several refs can leave the same column (one field referenced by three
      // tables, say), and the flow anchors them all to the identical handle —
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

      const writeRef = (refId: string, patch: (current: Ref) => Partial<Ref>) => {
        if (!doc || !canWrite) return;
        const refs = getRefsMap(doc);
        const current = refs.get(refId);
        if (current) refs.set(refId, { ...current, ...patch(current) });
      };

      return project.refs.map((ref): RefEdgeType => {
        const fromTable = tablesById.get(ref.from.tableId);
        const toTable = tablesById.get(ref.to.tableId);

        const fromNode = nodesById.get(ref.from.tableId);
        const toNode = nodesById.get(ref.to.tableId);

        const refIssues = showValidationIssues ? issuesByRef.get(ref.id) : undefined;

        const fromBox = tableBoxOf(fromNode, fromTable);
        const toBox = tableBoxOf(toNode, toTable);

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

        const data: RefEdgeData = {
          cardinality: ref.cardinality,
          onDelete: ref.onDelete,
          onUpdate: ref.onUpdate,
          sourceSlot: takeSlot(ref.from.tableId, sourceHandle),
          targetSlot: takeSlot(ref.to.tableId, targetHandle),
          routingPoints: ref.routingPoints,
          // Overwritten by the highlight overlay below — starts `false` here so
          // a base edge is never accidentally rendered highlighted before the
          // overlay runs.
          highlightLinks: false,
          connectedHighlight: false,
          // Kept for the overlay's field-level hover/selection check, without
          // which it would have no way to test a ref against
          // `hoveredFieldId`/`selectedFieldId` without re-deriving them from
          // the handle ids (lossy in compact mode).
          fromFieldId: ref.from.fieldId,
          toFieldId: ref.to.fieldId,
          hasIssue: Boolean(refIssues?.length),
          issueMessages: refIssues?.map((issue) => issue.message),
          color: ref.style?.color,
          palette,
          onPaletteChange,
          onSelectEdge,
          onColorChange: (color: string | undefined) =>
            writeRef(ref.id, (current) => ({ style: { ...current.style, color } })),
          onRoutingPointsChange: (routingPoints: RoutingPoint[] | undefined) => writeRef(ref.id, () => ({ routingPoints })),
          onCardinalityChange: (cardinality: RefCardinality) => writeRef(ref.id, () => ({ cardinality })),
          onDeleteActionChange: !canWrite
            ? undefined
            : (onDelete: RefAction | undefined) => writeRef(ref.id, () => ({ onDelete })),
          onUpdateActionChange: !canWrite
            ? undefined
            : (onUpdate: RefAction | undefined) => writeRef(ref.id, () => ({ onUpdate })),
          // Swaps which table/field is "from" and which is "to" — the arrow
          // (and, for one-to-many, which end reads "1" vs "n") flips to match,
          // with no change to `cardinality` itself: one-to-one and many-to-many
          // read the same from either direction, and one-to-many's "1"/"n"
          // labels are derived from from/to position already, so swapping the
          // endpoints is the whole fix.
          onReverseDirection: !canWrite
            ? undefined
            : () => writeRef(ref.id, (current) => ({ from: current.to, to: current.from })),
          onDeleteRef: !canWrite
            ? undefined
            : () => {
                if (!doc) return;
                getRefsMap(doc).delete(ref.id);
                // Read at click time, not captured in this build: the current
                // selection must not be a dependency of the heavy pass.
                if (selectedEdgeId() === ref.id) onSelectEdge(null);
              },
        };

        return {
          id: ref.id,
          source: ref.from.tableId,
          target: ref.to.tableId,
          sourceHandle,
          targetHandle,
          type: "ref",
          selected: false,
          data,
          // No `markerEnd`: the arrowhead is drawn inside `RefEdge` so it can
          // follow the stroke's live colour and opacity, and hold a constant
          // screen size instead of scaling with the (zoom-compensated) width.
        };
      });
    });
  });

  /**
   * The cheap pass — see the class comment. Reuses the previous edge object
   * for any ref whose highlight flags didn't change (same trick as the node
   * merge), so a hover over one table doesn't hand the flow a fresh object for
   * the other few thousand edges too.
   */
  readonly edges = $derived.by((): RefEdgeType[] => {
    const baseEdges = this.baseEdges;
    const highlightLinks = this.input.highlightLinks();
    const hoveredFieldId = this.input.hoveredFieldId();
    const hoveredTableId = this.input.hoveredTableId();
    const selectedFieldId = this.input.selectedFieldId();
    const selectedEdgeId = this.input.selectedEdgeId();
    const selectedTableIdSet = new Set(this.input.selectedTableIds());

    const previous = this.overlay;
    const nextOverlay = new Map<string, OverlayEntry>();
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
      const prev = previous.get(edge.id);
      if (
        prev &&
        prev.base === edge.data &&
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
      nextOverlay.set(edge.id, { flags, base: edge.data, edge: merged });
      return merged;
    });
    this.overlay = nextOverlay;
    return result;
  });

  constructor(input: CanvasEdgesInput) {
    this.input = input;
  }
}
