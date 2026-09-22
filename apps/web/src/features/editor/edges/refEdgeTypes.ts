import type { Edge } from "@xyflow/svelte";
import type { RefAction, RefCardinality, RoutingPoint } from "@athanordb/shared";

export interface RefEdgeData {
  cardinality: RefCardinality;
  /** Rank among the refs sharing this edge's source/target handle — shifts the cardinality chip so co-located refs don't stack on one spot. */
  sourceSlot?: number;
  targetSlot?: number;
  routingPoints?: RoutingPoint[];
  highlightLinks?: boolean;
  /** True when this edge touches the currently hovered or selected table — highlights it independently of the global `highlightLinks` toggle. */
  connectedHighlight?: boolean;
  /** This ref's raw endpoint field ids — kept alongside the geometry-derived handle strings (lossy in compact mode) so the highlight overlay in `canvasEdges` can test a ref against `hoveredFieldId`/`selectedFieldId` without re-deriving them. */
  fromFieldId: string;
  toFieldId: string;
  /** Custom highlight color override — falls back to the cardinality's default color when unset. */
  color?: string;
  /** True when this ref has a validation issue (see `packages/dbml-engine/src/validate.ts`) and the canvas-wide "show schema issues" toggle is on — draws the line in the issue colour regardless of hover/selection. */
  hasIssue?: boolean;
  /** This ref's own issue messages — shown on hover via the edge's tooltip-less label; kept on `data` for the context menu / future surfacing. */
  issueMessages?: string[];
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onColorChange: (color: string | undefined) => void;
  onCardinalityChange?: (cardinality: RefCardinality) => void;
  onDelete?: RefAction;
  onUpdate?: RefAction;
  onDeleteActionChange?: (action: RefAction | undefined) => void;
  onUpdateActionChange?: (action: RefAction | undefined) => void;
  onReverseDirection?: () => void;
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
  onDeleteRef?: () => void;
  onSelectEdge?: (id: string | null) => void;
  [key: string]: unknown;
}

export type RefEdgeType = Edge<RefEdgeData, "ref">;

export const CARDINALITY_STYLE: Record<RefCardinality, { stroke: string; label: string }> = {
  "one-to-one": { stroke: "#818cf8", label: "1–1" },
  "one-to-many": { stroke: "#34d399", label: "1–n" },
  "many-to-many": { stroke: "#fbbf24", label: "n–n" },
};
