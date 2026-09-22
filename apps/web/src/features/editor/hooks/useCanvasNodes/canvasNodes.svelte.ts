import { untrack } from "svelte";
import * as Y from "yjs";
import {
  getEnumsMap,
  getMetaMap,
  getRefsMap,
  getStickyNotesMap,
  getTableGroupsMap,
  getTablesMap,
  getZonesMap,
  type Project,
} from "@athanordb/shared";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import { DEFAULT_PALETTE } from "@/components/inputs/colorSwatches";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import type { CanvasNode } from "@/types/index";
import { time } from "@/utils/perfMonitor";
import { buildZoneNodes } from "./buildZoneNodes";
import { buildTableNodes } from "./buildTableNodes";
import { buildStickyNodes } from "./buildStickyNodes";
import { buildEnumNodes } from "./buildEnumNodes";
import { buildTableGroupNodes } from "./buildTableGroupNodes";
import type { TableNodeCache } from "./tableNodeCache";

export interface CanvasNodesInput {
  liveProject: () => Project | null;
  doc: () => Y.Doc | null;
  refFieldIdsByTable: () => Map<string, Set<string>>;
  user: () => string;
  onGoToDbml: (tableName: string) => void;
  /** Fires when the pointer enters/leaves a specific column row (`null` on leave) — narrows link highlighting to that column instead of the whole table. */
  onFieldHoverChange: (fieldId: string | null) => void;
  /** Fires when the pointer enters/leaves a table (`null` on leave) — highlights all relations of the table. */
  onTableHoverChange: (tableId: string | null) => void;
  selectedFieldId: () => string | null;
  onSelectField: (fieldId: string | null) => void;
  /** False for a `view` grant: nodes still render and select, but nothing they do reaches the document. */
  canWrite: () => boolean;
  /** Per-table validation issues, from `ProjectEditor`'s `validateProject(liveProject)`. */
  issuesByTable: () => Map<string, ValidationIssue[]>;
  /** The canvas-wide "show validation issues" toggle — see `CanvasToolbar`. */
  showValidationIssues: () => boolean;
}

/**
 * merged node -> the built node it was derived from.
 *
 * Without this, carrying `selected`/`measured` forward would hand the flow a
 * brand-new object for every node on every rebuild, undoing the per-table node
 * cache (`tableNodeCache.ts`) one layer further up: the flow's `adoptUserNodes`
 * skips a node entirely when the user object is reference-identical to the one
 * it already holds, so keeping identities stable for untouched tables is the
 * whole point.
 */
type DerivedFrom = WeakMap<CanvasNode, CanvasNode>;

/** A dragged zone's members, snapshotted at drag start as offsets from the zone's position. */
type ZoneMembers = Map<string, { x: number; y: number }>;

/**
 * The canvas's node array and everything that writes to it.
 *
 * Builds the flow's node array (zones, tables, sticky notes, enums, groups —
 * in that paint order so tables/notes drag on top of zones) from the live Yjs
 * project, wiring each node's `data` callbacks straight to doc mutations, and
 * owns the local node state the flow is bound to (`nodes`), which is what
 * shows live drag position: the doc only learns a position once the drag
 * commits, so without a local copy the node would visually snap around
 * mid-drag.
 *
 * Every rebuild is merged into the local state rather than replacing it,
 * carrying across two things the doc knows nothing about:
 *
 *  - **`selected`**, which is local UI state. A rebuild (any doc mutation,
 *    including a bulk colour change applied *from* the current selection)
 *    would otherwise wipe it, dropping the selection and closing whatever UI
 *    depends on it (the multi-select colour toolbar) mid-use.
 *
 *  - **`measured`**, the flow's own measurement of the rendered node box. A
 *    node object rebuilt without it makes `adoptUserNodes` treat the *whole
 *    canvas* as un-measured, which re-measures every node:
 *    `getBoundingClientRect` on every handle of every table — 16k forced
 *    layouts on a 500-table schema at full detail. Carrying the previous box
 *    forward keeps the canvas "initialized"; a node whose size really did
 *    change still gets corrected by the flow's own ResizeObserver, for that
 *    one node instead of all of them.
 */
export class CanvasNodesState {
  /** The flow's node array — bound two-way to `<SvelteFlow bind:nodes>`. */
  nodes = $state.raw<CanvasNode[]>([]);
  /** True between a drag's start and its drop — the edge layer freezes its geometry pass meanwhile. */
  dragging = $state(false);

  private readonly input: CanvasNodesInput;
  // Survives every rebuild: it is the thing that makes a rebuild cheap.
  private readonly tableNodeCache: TableNodeCache = new Map();
  private readonly derivedFrom: DerivedFrom = new WeakMap();
  private readonly zoneDragMembers = new Map<string, ZoneMembers>();

  // Stable identity, so it can be part of the table cache key rather than
  // invalidating every table on every rebuild.
  private readonly onPaletteChange = (next: string[]) => {
    const doc = this.input.doc();
    if (doc) getMetaMap(doc).set("paletteColors", next);
  };

  private readonly builtNodes = $derived.by((): CanvasNode[] => {
    const liveProject = this.input.liveProject();
    const doc = this.input.doc();
    if (!liveProject || !doc) return [];

    const palette = liveProject.paletteColors ?? DEFAULT_PALETTE;
    const canWrite = this.input.canWrite();
    const refFieldIdsByTable = this.input.refFieldIdsByTable();
    const user = this.input.user();
    const selectedFieldId = this.input.selectedFieldId();
    const issuesByTable = this.input.issuesByTable();
    const showValidationIssues = this.input.showValidationIssues();

    return time("canvas.buildNodes", () => [
      ...buildZoneNodes(liveProject.zones, doc, palette, this.onPaletteChange, canWrite),
      ...buildTableNodes(
        liveProject.tables,
        liveProject.refs,
        doc,
        refFieldIdsByTable,
        user,
        palette,
        this.onPaletteChange,
        this.input.onGoToDbml,
        this.input.onFieldHoverChange,
        this.input.onTableHoverChange,
        selectedFieldId,
        this.input.onSelectField,
        canWrite,
        issuesByTable,
        showValidationIssues,
        this.tableNodeCache,
      ),
      ...buildStickyNodes(liveProject.stickyNotes, doc, palette, this.onPaletteChange, canWrite),
      ...buildEnumNodes(liveProject.enums, doc, canWrite),
      ...buildTableGroupNodes(liveProject.tableGroups, liveProject.tables, doc, canWrite),
    ]);
  });

  constructor(input: CanvasNodesInput) {
    this.input = input;

    // Before the DOM update, so the flow never renders a frame of the stale
    // node set.
    $effect.pre(() => {
      const built = this.builtNodes;
      untrack(() => {
        this.nodes = time("canvas.selectionPreservingMerge", () => this.merge(this.nodes, built));
      });
    });
  }

  private merge(prevNodes: CanvasNode[], builtNodes: CanvasNode[]): CanvasNode[] {
    const derivedFrom = this.derivedFrom;
    const previousById = new Map(prevNodes.map((node) => [node.id, node]));
    return builtNodes.map((node) => {
      const previous = previousById.get(node.id);
      if (!previous) return node;

      const keepSelection = Boolean(previous.selected) && !node.selected;
      // A table node's box size is driven by its `detailLevel` (compact
      // renders 0 field rows, full renders every field). Carrying the old
      // `measured` box forward across a detail-level change hands the flow a
      // box that's now simply wrong — for every table at once when the change
      // is a bulk one. Not carrying it lets every table whose size actually
      // changed re-measure together in the one settle-down pass the flow
      // already does for a freshly-unmeasured node, the same path a first load
      // goes through.
      const sizeMayHaveChanged =
        node.type === "table" &&
        previous.type === "table" &&
        previous.data.table.detailLevel !== node.data.table.detailLevel;
      const keepMeasured = Boolean(previous.measured) && !node.measured && !sizeMayHaveChanged;
      if (!keepSelection && !keepMeasured) {
        derivedFrom.set(node, node);
        return node;
      }
      // Same source node, same selection: the object already in the flow is
      // exactly what this rebuild would produce, so keep its identity.
      if (derivedFrom.get(previous) === node && Boolean(previous.selected) === keepSelection) return previous;

      const merged = {
        ...node,
        ...(keepSelection ? { selected: true } : {}),
        ...(keepMeasured ? { measured: previous.measured } : {}),
      } as CanvasNode;
      derivedFrom.set(merged, node);
      return merged;
    });
  }

  /** Selects exactly `ids` among `candidates` (all nodes when omitted) — the path search, DBML navigation and the lasso all go through. */
  setSelection(isSelected: (node: CanvasNode) => boolean): void {
    let changed = false;
    const next = this.nodes.map((node) => {
      const selected = isSelected(node);
      if (Boolean(node.selected) === selected) return node;
      changed = true;
      return { ...node, selected } as CanvasNode;
    });
    if (changed) this.nodes = next;
  }

  /**
   * Snapshots each dragged zone's members — every table/sticky/enum whose
   * centre sits inside it — once, at drag start, so the group moves rigidly
   * together instead of members joining/leaving as the zone sweeps over them.
   */
  onDragStart = (dragged: CanvasNode[]): void => {
    this.dragging = true;
    const nodes = this.nodes;
    for (const zoneNode of dragged) {
      if (zoneNode.type !== "zone") continue;
      const offsets: ZoneMembers = new Map();
      const zx = zoneNode.position.x;
      const zy = zoneNode.position.y;
      const zw = zoneNode.width ?? 0;
      const zh = zoneNode.height ?? 0;
      for (const other of nodes) {
        if (other.type !== "table" && other.type !== "sticky" && other.type !== "enum") continue;
        const w = other.measured?.width ?? (other.type === "sticky" ? other.width : undefined) ?? DEFAULT_TABLE_WIDTH;
        const h = other.measured?.height ?? (other.type === "sticky" ? other.height : undefined) ?? DEFAULT_TABLE_HEIGHT;
        const cx = other.position.x + w / 2;
        const cy = other.position.y + h / 2;
        if (cx >= zx && cx <= zx + zw && cy >= zy && cy <= zy + zh) {
          offsets.set(other.id, { x: other.position.x - zx, y: other.position.y - zy });
        }
      }
      this.zoneDragMembers.set(zoneNode.id, offsets);
    }
  };

  /** Moves every dragged zone's members along with it — the flow itself only moves what was grabbed. */
  onDrag = (dragged: CanvasNode[]): void => {
    if (this.zoneDragMembers.size === 0) return;
    time("canvas.zoneDragMembers", () => {
      const memberPositions = new Map<string, { x: number; y: number }>();
      const draggedIds = new Set(dragged.map((node) => node.id));
      for (const node of this.nodes) {
        const offsets = draggedIds.has(node.id) ? this.zoneDragMembers.get(node.id) : undefined;
        if (!offsets) continue;
        for (const [memberId, offset] of offsets) {
          memberPositions.set(memberId, { x: node.position.x + offset.x, y: node.position.y + offset.y });
        }
      }
      if (memberPositions.size === 0) return;
      this.nodes = this.nodes.map((node) => {
        const position = memberPositions.get(node.id);
        return position ? ({ ...node, position } as CanvasNode) : node;
      });
    });
  };

  /**
   * Commits the drop: every dragged node, plus any zone members that moved
   * with it, writes its final position to the doc — in one transaction, so a
   * zone and its members land as one update (and one undo step).
   */
  onDragStop = (dragged: CanvasNode[]): void => {
    this.dragging = false;
    const moved = new Set(dragged.map((node) => node.id));
    for (const node of dragged) {
      const members = this.zoneDragMembers.get(node.id);
      if (members) for (const memberId of members.keys()) moved.add(memberId);
    }
    this.zoneDragMembers.clear();

    const doc = this.input.canWrite() ? this.input.doc() : null;
    if (!doc) return;
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of this.nodes) if (moved.has(node.id)) positions.set(node.id, node.position);

    time("canvas.commitDrag", () =>
      doc.transact(() => {
        const tables = getTablesMap(doc);
        const zones = getZonesMap(doc);
        const stickyNotes = getStickyNotesMap(doc);
        const enums = getEnumsMap(doc);
        for (const [id, position] of positions) {
          const table = tables.get(id);
          if (table) {
            tables.set(id, { ...table, position });
            continue;
          }
          const zone = zones.get(id);
          if (zone) {
            zones.set(id, { ...zone, position });
            continue;
          }
          const note = stickyNotes.get(id);
          if (note) {
            stickyNotes.set(id, { ...note, position });
            continue;
          }
          const enumDef = enums.get(id);
          if (enumDef) enums.set(id, { ...enumDef, position });
        }
      }),
    );
  };

  /**
   * Removes nodes from the document: tables (and every ref touching them),
   * zones, sticky notes, enums — and, for a table group, only the group
   * itself (ungroup: member tables are never touched by this).
   */
  deleteNodes(ids: Iterable<string>): void {
    const doc = this.input.canWrite() ? this.input.doc() : null;
    if (!doc) return;
    doc.transact(() => {
      const tables = getTablesMap(doc);
      const zones = getZonesMap(doc);
      const stickyNotes = getStickyNotesMap(doc);
      const enums = getEnumsMap(doc);
      const tableGroups = getTableGroupsMap(doc);
      const refs = getRefsMap(doc);
      for (const id of ids) {
        if (tables.has(id)) {
          tables.delete(id);
          for (const [refId, ref] of refs.entries()) {
            if (ref.from.tableId === id || ref.to.tableId === id) refs.delete(refId);
          }
        } else if (zones.has(id)) {
          zones.delete(id);
        } else if (stickyNotes.has(id)) {
          stickyNotes.delete(id);
        } else if (enums.has(id)) {
          enums.delete(id);
        } else if (tableGroups.has(id)) {
          tableGroups.delete(id);
        }
      }
    });
  }
}
