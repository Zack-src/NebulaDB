import { useCallback, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import {
  getEnumsMap,
  getMetaMap,
  getRefsMap,
  getStickyNotesMap,
  getTableGroupsMap,
  getTablesMap,
  getZonesMap,
  type Comment,
  type EnumValue,
  type Field,
  type Project,
  type Table,
  type TableIndex,
} from "@athanordb/shared";
import { DEFAULT_PALETTE } from "@/components/inputs/ColorSwatchPicker";
import type { ZoneNodeType } from "@/features/editor/nodes/ZoneNode";
import type { TableNodeType } from "@/features/editor/nodes/TableNode";
import type { StickyNoteNodeType } from "@/features/editor/nodes/StickyNoteNode";
import type { EnumNodeType } from "@/features/editor/nodes/EnumNode";
import type { TableGroupNodeType } from "@/features/editor/nodes/TableGroupNode";
import type { CursorNodeType } from "@/features/collaboration/CursorNode";
import type { CanvasNode } from "@/types/index";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";

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
) {
  const builtNodes: CanvasNode[] = useMemo(() => {
    if (!liveProject || !doc) return [];

    const palette = liveProject.paletteColors ?? DEFAULT_PALETTE;
    const onPaletteChange = (next: string[]) => {
      getMetaMap(doc).set("paletteColors", next);
    };

    const zoneNodes: ZoneNodeType[] = liveProject.zones.map((zone) => ({
      id: zone.id,
      position: zone.position,
      width: zone.size.width,
      height: zone.size.height,
      type: "zone",
      data: {
        zone,
        palette,
        onPaletteChange,
        onLabelChange: (label: string) => {
          const zones = getZonesMap(doc);
          const current = zones.get(zone.id);
          if (current) zones.set(zone.id, { ...current, label });
        },
        onColorChange: (color: string) => {
          const zones = getZonesMap(doc);
          const current = zones.get(zone.id);
          if (current) zones.set(zone.id, { ...current, style: { ...current.style, color } });
        },
        onResize: (position, size) => {
          const zones = getZonesMap(doc);
          const current = zones.get(zone.id);
          if (current) zones.set(zone.id, { ...current, position, size });
        },
      },
    }));

    const tableNodes: TableNodeType[] = liveProject.tables.map((table) => ({
      id: table.id,
      position: table.position,
      type: "table",
      data: {
        table,
        refFieldIds: refFieldIdsByTable.get(table.id) ?? new Set(),
        highlightLinks,
        currentUser: user,
        palette,
        onPaletteChange,
        onGoToDbml: () => onGoToDbml(table.name),
        onRename: (name: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (current) tables.set(table.id, { ...current, name });
        },
        onStyleChange: (color?: string, borderColor?: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (current) tables.set(table.id, { ...current, style: { color, borderColor } });
        },
        onAddComment: (text: string, fieldId?: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          const comment: Comment = { id: crypto.randomUUID(), author: user, text, createdAt: new Date().toISOString(), fieldId };
          tables.set(table.id, { ...current, comments: [...(current.comments ?? []), comment] });
        },
        onDeleteComment: (commentId: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          tables.set(table.id, { ...current, comments: (current.comments ?? []).filter((c) => c.id !== commentId) });
        },
        onUpdateField: (fieldId: string, updates: Partial<Field>) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          const updatedFields = current.fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f));
          tables.set(table.id, { ...current, fields: updatedFields });
        },
        onAddField: (fieldData: Omit<Field, "id">) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          const newField: Field = { id: crypto.randomUUID(), ...fieldData };
          tables.set(table.id, { ...current, fields: [...current.fields, newField] });
        },
        onDeleteField: (fieldId: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          const updatedFields = current.fields.filter((f) => f.id !== fieldId);
          const refs = getRefsMap(doc);
          doc.transact(() => {
            for (const [refId, ref] of refs.entries()) {
              if (
                (ref.from.tableId === table.id && ref.from.fieldId === fieldId) ||
                (ref.to.tableId === table.id && ref.to.fieldId === fieldId)
              ) {
                refs.delete(refId);
              }
            }
            tables.set(table.id, { ...current, fields: updatedFields });
          });
        },
        // A table has at most one primary key — a 2+ column one is a
        // `pk: true` index (DBML/SQL have no other way to express it), same
        // as `dbml.ts`'s import side already treats it. Adding or flipping
        // an index to `pk: true` clears every individual field's own `pk`
        // flag and any *other* index's `pk` flag in the same transaction, so
        // the table never ends up with two conflicting PK declarations.
        onAddIndex: (fieldIds: string[], opts: { unique?: boolean; pk?: boolean; name?: string }) => {
          if (fieldIds.length === 0) return;
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          const newIndex: TableIndex = { id: crypto.randomUUID(), fieldIds, unique: opts.unique, pk: opts.pk, name: opts.name };
          doc.transact(() => {
            const fields = opts.pk ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f)) : current.fields;
            const indexes = opts.pk ? current.indexes.map((idx) => (idx.pk ? { ...idx, pk: false } : idx)) : current.indexes;
            tables.set(table.id, { ...current, fields, indexes: [...indexes, newIndex] });
          });
        },
        onUpdateIndex: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          doc.transact(() => {
            const fields = updates.pk ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f)) : current.fields;
            const indexes = current.indexes.map((idx) => {
              if (idx.id === indexId) return { ...idx, ...updates };
              return updates.pk && idx.pk ? { ...idx, pk: false } : idx;
            });
            tables.set(table.id, { ...current, fields, indexes });
          });
        },
        onDeleteIndex: (indexId: string) => {
          const tables = getTablesMap(doc);
          const current = tables.get(table.id);
          if (!current) return;
          tables.set(table.id, { ...current, indexes: current.indexes.filter((idx) => idx.id !== indexId) });
        },
      },
    }));

    const stickyNodes: StickyNoteNodeType[] = liveProject.stickyNotes.map((note) => ({
      id: note.id,
      position: note.position,
      width: note.size.width,
      height: note.size.height,
      type: "sticky",
      data: {
        note,
        palette,
        onPaletteChange,
        onTextChange: (text: string) => {
          const stickyNotes = getStickyNotesMap(doc);
          const current = stickyNotes.get(note.id);
          if (current) stickyNotes.set(note.id, { ...current, text });
        },
        onColorChange: (color: string) => {
          const stickyNotes = getStickyNotesMap(doc);
          const current = stickyNotes.get(note.id);
          if (current) stickyNotes.set(note.id, { ...current, style: { ...current.style, color } });
        },
        onResize: (position, size) => {
          const stickyNotes = getStickyNotesMap(doc);
          const current = stickyNotes.get(note.id);
          if (current) stickyNotes.set(note.id, { ...current, position, size });
        },
      },
    }));

    const enumNodes: EnumNodeType[] = liveProject.enums.map((enumDef) => ({
      id: enumDef.id,
      position: enumDef.position,
      type: "enum",
      data: {
        enumDef,
        onRename: (name: string) => {
          const enums = getEnumsMap(doc);
          const current = enums.get(enumDef.id);
          if (current) enums.set(enumDef.id, { ...current, name });
        },
        onAddValue: () => {
          const enums = getEnumsMap(doc);
          const current = enums.get(enumDef.id);
          if (!current) return;
          const value: EnumValue = { id: crypto.randomUUID(), name: `value_${current.values.length + 1}` };
          enums.set(enumDef.id, { ...current, values: [...current.values, value] });
        },
        onRenameValue: (valueId: string, name: string) => {
          const enums = getEnumsMap(doc);
          const current = enums.get(enumDef.id);
          if (!current) return;
          enums.set(enumDef.id, { ...current, values: current.values.map((v) => (v.id === valueId ? { ...v, name } : v)) });
        },
        onDeleteValue: (valueId: string) => {
          const enums = getEnumsMap(doc);
          const current = enums.get(enumDef.id);
          if (!current) return;
          enums.set(enumDef.id, { ...current, values: current.values.filter((v) => v.id !== valueId) });
        },
        onReorderValue: (valueId: string, direction: "up" | "down") => {
          const enums = getEnumsMap(doc);
          const current = enums.get(enumDef.id);
          if (!current) return;
          const index = current.values.findIndex((v) => v.id === valueId);
          const swapWith = direction === "up" ? index - 1 : index + 1;
          if (index < 0 || swapWith < 0 || swapWith >= current.values.length) return;
          const values = [...current.values];
          [values[index], values[swapWith]] = [values[swapWith], values[index]];
          enums.set(enumDef.id, { ...current, values });
        },
      },
    }));

    // A group's box is derived, not stored — position/size come from
    // wherever its member tables currently sit, using a generous fixed
    // per-table footprint rather than each table's real rendered height
    // (not available here: `liveProject` has no measured DOM size, and this
    // memo runs before React Flow has measured anything). Loose enough to
    // rarely clip a real table, not pixel-perfect — a visual grouping
    // indicator, not a hard boundary.
    const GROUP_MEMBER_WIDTH_ESTIMATE = 240;
    const GROUP_MEMBER_HEIGHT_ESTIMATE = 280;
    const GROUP_PADDING = 28;
    const GROUP_LABEL_MARGIN = 16;
    const tableById = new Map(liveProject.tables.map((t) => [t.id, t]));
    const tableGroupNodes: TableGroupNodeType[] = liveProject.tableGroups.map((group) => {
      const members = group.tableIds.map((id) => tableById.get(id)).filter((t): t is Table => Boolean(t));
      const minX = members.length ? Math.min(...members.map((t) => t.position.x)) : 0;
      const minY = members.length ? Math.min(...members.map((t) => t.position.y)) : 0;
      const maxX = members.length
        ? Math.max(...members.map((t) => t.position.x + (t.size?.width ?? GROUP_MEMBER_WIDTH_ESTIMATE)))
        : GROUP_MEMBER_WIDTH_ESTIMATE;
      const maxY = members.length
        ? Math.max(...members.map((t) => t.position.y + (t.size?.height ?? GROUP_MEMBER_HEIGHT_ESTIMATE)))
        : GROUP_MEMBER_HEIGHT_ESTIMATE;

      return {
        id: group.id,
        type: "tablegroup",
        position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_LABEL_MARGIN },
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_MARGIN,
        draggable: false,
        zIndex: -1,
        data: {
          group,
          memberCount: members.length,
          onRename: (name: string) => {
            const groups = getTableGroupsMap(doc);
            const current = groups.get(group.id);
            if (current) groups.set(group.id, { ...current, name });
          },
          onUngroup: () => {
            getTableGroupsMap(doc).delete(group.id);
          },
        },
      };
    });

    return [...zoneNodes, ...tableNodes, ...stickyNodes, ...enumNodes, ...tableGroupNodes];
  }, [liveProject, doc, refFieldIdsByTable, user, highlightLinks, onGoToDbml]);

  // Resetting during render (React's documented pattern for "adjust state
  // when an input changes") rather than in an effect avoids an extra render pass.
  const [nodes, setNodes] = useState<CanvasNode[]>(builtNodes);
  const [prevBuiltNodes, setPrevBuiltNodes] = useState(builtNodes);
  if (builtNodes !== prevBuiltNodes) {
    setPrevBuiltNodes(builtNodes);
    // `selected` is local React Flow UI state, not part of the doc — a fresh
    // `builtNodes` (any doc mutation, including e.g. a bulk color change
    // applied *from* the current selection) would otherwise wipe it,
    // dropping the selection and closing whatever UI depends on it
    // (the multi-select color toolbar) mid-use.
    setNodes((prevNodes) => {
      const selectedIds = new Set(prevNodes.filter((n) => n.selected).map((n) => n.id));
      return selectedIds.size === 0 ? builtNodes : builtNodes.map((n) => (selectedIds.has(n.id) ? { ...n, selected: true } : n));
    });
  }

  // Per zone currently being dragged: each contained table/sticky's offset
  // from the zone's position, snapshotted once at drag start (not
  // recomputed every frame) so the group moves rigidly together instead of
  // members joining/leaving as the zone sweeps over them mid-drag.
  const zoneDragMembersRef = useRef<Map<string, Map<string, { x: number; y: number }>>>(new Map());

  const onNodesChange = useCallback(
    // Typed against AllNodes since this is React Flow's nodes-prop change
    // handler and cursor nodes ride along in that same array — but cursor
    // nodes are always non-interactive (draggable/selectable/deletable:
    // false), so they never actually produce a change event; safe to narrow
    // back to CanvasNode for the part of this function that persists to the doc.
    (changes: NodeChange<CanvasNode | CursorNodeType>[]) => {
      // Dragging a zone also drags whatever table/sticky was inside it —
      // synthesize a "position" change for each member, riding along with
      // the zone's own change, so they flow through the same apply/commit
      // logic below without duplicating it.
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
            const w = other.measured?.width ?? (other.type === "sticky" ? other.width : undefined) ?? DEFAULT_TABLE_WIDTH;
            const h = other.measured?.height ?? (other.type === "sticky" ? other.height : undefined) ?? DEFAULT_TABLE_HEIGHT;
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

      const allChanges = [...(changes as NodeChange<CanvasNode>[]), ...memberChanges];
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
    [doc, nodes],
  );

  return { nodes, onNodesChange };
}
