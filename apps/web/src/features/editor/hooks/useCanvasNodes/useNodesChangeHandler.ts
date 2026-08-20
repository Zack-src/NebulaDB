import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as Y from "yjs";
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import {
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTableGroupsMap,
  getTablesMap,
  getZonesMap,
} from "@athanordb/shared";
import type { CanvasNode } from "@/types/index";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";

/**
 * React Flow's `onNodesChange` handler: applies changes to local node state
 * and commits position/removal changes back to the doc. Also makes dragging
 * a zone drag whatever table/sticky/enum was inside it along, by
 * synthesizing a "position" change for each member.
 *
 * Returns the handler alongside a `dragging` flag (true between a drag's
 * first `dragging: true` change and its `dragging: false` commit), which the
 * edge layer uses to stop re-deriving every relation's geometry sixty times a
 * second while a table is in flight.
 *
 * The current nodes are read through a ref rather than closed over: the array
 * is replaced on every drag frame, and a handler identity that changed with
 * it handed `<ReactFlow>` a new `onNodesChange` prop on every one of those
 * frames.
 */
export function useNodesChangeHandler(
  nodes: CanvasNode[],
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>,
  doc: Y.Doc | null,
): { onNodesChange: (changes: NodeChange<CanvasNode>[]) => void; dragging: boolean } {
  // Mirrored after commit rather than during render: the handler only ever
  // runs from a React Flow event, which is always after the commit that
  // produced the nodes it is about.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const setDraggingIfChanged = useCallback((next: boolean) => {
    if (draggingRef.current === next) return;
    draggingRef.current = next;
    setDragging(next);
  }, []);

  // Per zone currently being dragged: each contained table/sticky's offset
  // from the zone's position, snapshotted once at drag start (not
  // recomputed every frame) so the group moves rigidly together instead of
  // members joining/leaving as the zone sweeps over them mid-drag.
  const zoneDragMembersRef = useRef<Map<string, Map<string, { x: number; y: number }>>>(new Map());

  const onNodesChange = useCallback(
    // eslint-disable-next-line complexity -- one React Flow change can fan out across five Yjs maps (tables/zones/stickies/enums/groups) and a synthesized zone-drag member move; the branching mirrors that map count, not incidental structure
    (changes: NodeChange<CanvasNode>[]) => {
      const nodes = nodesRef.current;
      for (const change of changes) {
        if (change.type === "position" && typeof change.dragging === "boolean") setDraggingIfChanged(change.dragging);
      }
      const memberChanges: NodeChange<CanvasNode>[] = [];
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const zoneNode = nodes.find((n) => n.id === change.id);
        if (!zoneNode || zoneNode.type !== "zone") continue;

        let offsets = zoneDragMembersRef.current.get(zoneNode.id);
        if (!offsets) {
          offsets = new Map();
          const zx = zoneNode.position.x;
          const zy = zoneNode.position.y;
          const zw = zoneNode.width ?? 0;
          const zh = zoneNode.height ?? 0;
          for (const other of nodes) {
            if (other.type !== "table" && other.type !== "sticky" && other.type !== "enum") continue;
            const w =
              other.measured?.width ?? (other.type === "sticky" ? other.width : undefined) ?? DEFAULT_TABLE_WIDTH;
            const h =
              other.measured?.height ?? (other.type === "sticky" ? other.height : undefined) ?? DEFAULT_TABLE_HEIGHT;
            const cx = other.position.x + w / 2;
            const cy = other.position.y + h / 2;
            if (cx >= zx && cx <= zx + zw && cy >= zy && cy <= zy + zh) {
              offsets.set(other.id, { x: other.position.x - zx, y: other.position.y - zy });
            }
          }
          zoneDragMembersRef.current.set(zoneNode.id, offsets);
        }

        for (const [memberId, offset] of offsets) {
          memberChanges.push({
            id: memberId,
            type: "position",
            position: { x: change.position.x + offset.x, y: change.position.y + offset.y },
            dragging: change.dragging,
          });
        }

        if (change.dragging === false) zoneDragMembersRef.current.delete(zoneNode.id);
      }

      const allChanges = [...changes, ...memberChanges];
      setNodes((nds) => applyNodeChanges(allChanges, nds));
      if (!doc) return;
      const tables = getTablesMap(doc);
      const zones = getZonesMap(doc);
      const stickyNotes = getStickyNotesMap(doc);
      const enums = getEnumsMap(doc);
      const tableGroups = getTableGroupsMap(doc);
      for (const change of allChanges) {
        if (change.type === "position" && change.position && change.dragging === false) {
          if (tables.has(change.id)) {
            const current = tables.get(change.id);
            if (current) tables.set(change.id, { ...current, position: change.position });
          } else if (zones.has(change.id)) {
            const current = zones.get(change.id);
            if (current) zones.set(change.id, { ...current, position: change.position });
          } else if (stickyNotes.has(change.id)) {
            const current = stickyNotes.get(change.id);
            if (current) stickyNotes.set(change.id, { ...current, position: change.position });
          } else if (enums.has(change.id)) {
            const current = enums.get(change.id);
            if (current) enums.set(change.id, { ...current, position: change.position });
          }
        } else if (change.type === "remove") {
          if (tables.has(change.id)) {
            tables.delete(change.id);
            const refs = getRefsMap(doc);
            for (const [refId, ref] of refs.entries()) {
              if (ref.from.tableId === change.id || ref.to.tableId === change.id) refs.delete(refId);
            }
          } else if (zones.has(change.id)) {
            zones.delete(change.id);
          } else if (stickyNotes.has(change.id)) {
            stickyNotes.delete(change.id);
          } else if (enums.has(change.id)) {
            enums.delete(change.id);
          } else if (tableGroups.has(change.id)) {
            // Ungroup only — member tables are never touched by this.
            tableGroups.delete(change.id);
          }
        }
      }
    },
    [doc, setNodes, setDraggingIfChanged],
  );

  return { onNodesChange, dragging };
}
