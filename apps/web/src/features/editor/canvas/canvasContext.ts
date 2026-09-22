import { getContext, setContext } from "svelte";
import type { RemoteSelector } from "@/features/collaboration/awarenessStates.svelte";
import type { HighlightedFieldsMap } from "./highlightedFields";

/**
 * Canvas-wide state the table nodes read directly, rather than through each
 * node's `data`.
 *
 * Threading these through `data` would rebuild every node object (and hand
 * the flow a fresh node for every table) whenever one of them changed — a
 * remote peer selecting a table, or a relation lighting up under the pointer.
 * Read here, each table picks out only its own entry, and only the tables
 * whose entry actually changed update.
 */
export interface CanvasContext {
  /** tableId -> `|`-joined ids of that table's columns on a highlighted relation — see `highlightedFields.ts`. */
  readonly highlightedFields: HighlightedFieldsMap;
  /** tableId -> the remote collaborators who currently have that table selected. */
  readonly remoteSelections: Map<string, RemoteSelector[]>;
  /**
   * The viewport zoom, quantized to `ZOOM_STEP`. Every relation compensates its
   * stroke width, arrowhead and chips for zoom; reading this shared, stepped
   * value instead of the raw viewport means a pan (x/y only) touches no edge
   * at all, and a zoom gesture only reaches them on the handful of frames that
   * actually cross a step.
   */
  readonly zoom: number;
  /** Replaces the table's selection outline with a column selection — deselects every node. */
  deselectAllNodes: () => void;
}

/** 5% zoom steps are visually indistinguishable in stroke width/arrow size. */
export const ZOOM_STEP = 0.05;

export function quantizeZoom(zoom: number): number {
  return Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
}

const KEY = Symbol("athanordb.canvas");

export function setCanvasContext(context: CanvasContext): void {
  setContext(KEY, context);
}

export function getCanvasContext(): CanvasContext {
  const context = getContext<CanvasContext | undefined>(KEY);
  if (!context) throw new Error("canvas context missing: table nodes must render inside CanvasArea");
  return context;
}
