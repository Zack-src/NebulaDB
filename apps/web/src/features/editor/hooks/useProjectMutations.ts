import { useCallback, useMemo } from "react";
import * as Y from "yjs";
import type { Connection } from "@xyflow/react";
import {
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTableGroupsMap,
  getTablesMap,
  getZonesMap,
  type DetailLevel,
  type Project,
} from "@athanordb/shared";
import { computeAutoLayout } from "@/features/editor/canvas/autoLayout";
import type { RefEdgeType } from "@/features/editor/edges/RefEdge";
import type { CanvasNode } from "@/types/index";

/** Every doc-mutating action the project toolbar/canvas can trigger — add/duplicate elements, connect/delete refs, bulk detail-level and layout changes. */
export function useProjectMutations(liveProject: Project | null, doc: Y.Doc | null, nodes: CanvasNode[]) {
  const addTable = (position?: { x: number; y: number }) => {
    if (!doc) return;
    const tables = getTablesMap(doc);
    const id = crypto.randomUUID();
    const index = tables.size;
    tables.set(id, {
      id,
      name: `table_${index + 1}`,
      // A field-less table isn't just useless — @dbml/core's parser actually
      // throws on `Table t { }` (zero columns), which would break the live
      // DBML round-trip the moment this table's text gets re-imported (e.g.
      // the user edits any other table before giving this one a column).
      // Seeding an id column sidesteps that entirely, and matches how every
      // other schema tool (dbdiagram included) seeds a new table.
      fields: [{ id: crypto.randomUUID(), name: "id", type: "int", pk: true, increment: true }],
      indexes: [],
      position: position ?? { x: (index % 6) * 260, y: Math.floor(index / 6) * 200 },
      detailLevel: "standard",
    });
  };

  const addZone = (position?: { x: number; y: number }) => {
    if (!doc) return;
    const zones = getZonesMap(doc);
    const id = crypto.randomUUID();
    zones.set(id, {
      id,
      label: "Zone",
      position: position ?? { x: 40, y: 40 },
      size: { width: 300, height: 220 },
      style: { color: "#f59e0b" },
    });
  };

  const addStickyNote = (position?: { x: number; y: number }) => {
    if (!doc) return;
    const stickyNotes = getStickyNotesMap(doc);
    const id = crypto.randomUUID();
    stickyNotes.set(id, {
      id,
      text: "",
      position: position ?? { x: 60, y: 60 },
      size: { width: 160, height: 120 },
      style: { color: "#fef08a" },
    });
  };

  const addEnum = (position?: { x: number; y: number }) => {
    if (!doc) return;
    const enums = getEnumsMap(doc);
    const id = crypto.randomUUID();
    const index = enums.size;
    enums.set(id, {
      id,
      name: `enum_${index + 1}`,
      values: [{ id: crypto.randomUUID(), name: "value_1" }],
      position: position ?? { x: 40, y: 40 },
    });
  };

  /** Figma-style grouping: select 2+ tables, group them — the group is purely a named membership list, no position of its own (see TableGroupNode.tsx). */
  const groupSelectedTables = (tableIds: string[]) => {
    if (!doc || tableIds.length < 2) return;
    const groups = getTableGroupsMap(doc);
    const id = crypto.randomUUID();
    groups.set(id, { id, name: `group_${groups.size + 1}`, tableIds });
  };

  const setAllDetailLevels = (level: DetailLevel) => {
    if (!doc) return;
    const tables = getTablesMap(doc);
    tables.forEach((table, id) => tables.set(id, { ...table, detailLevel: level }));
  };

  // Highlights a detail-level button only when every table currently shares that
  // level — once tables diverge (e.g. per-table override), no button is "active".
  const activeDetailLevel: DetailLevel | null = useMemo(() => {
    const tables = liveProject?.tables ?? [];
    if (tables.length === 0) return null;
    const [first, ...rest] = tables;
    return rest.every((t) => t.detailLevel === first.detailLevel) ? first.detailLevel : null;
  }, [liveProject]);

  const autoLayout = () => {
    if (!doc || !liveProject) return;
    const positions = computeAutoLayout(liveProject.tables, liveProject.refs);
    const tables = getTablesMap(doc);
    doc.transact(() => {
      for (const [id, position] of positions) {
        const current = tables.get(id);
        if (current) tables.set(id, { ...current, position });
      }
    });
  };

  const setTablesColor = (tableIds: string[], color: string) => {
    if (!doc || tableIds.length === 0) return;
    const tables = getTablesMap(doc);
    doc.transact(() => {
      for (const id of tableIds) {
        const current = tables.get(id);
        if (current) tables.set(id, { ...current, style: { ...current.style, color } });
      }
    });
  };

  // "Reset all link routing" used to live here; it is now the built-in
  // `athanordb.core-canvas` plugin's `reset-link-routing` command, applied
  // through `writeProjectToDoc` like any other canvas command.

  const duplicateSelected = useCallback(() => {
    if (!doc) return;
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const OFFSET = 24;
    doc.transact(() => {
      for (const node of selected) {
        if (node.type === "table") {
          const tables = getTablesMap(doc);
          const src = node.data.table;
          const fieldIdMap = new Map(src.fields.map((f) => [f.id, crypto.randomUUID()]));
          const id = crypto.randomUUID();
          tables.set(id, {
            ...src,
            id,
            name: `${src.name}_copy`,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
            fields: src.fields.map((f) => ({ ...f, id: fieldIdMap.get(f.id)! })),
            indexes: src.indexes.map((idx) => ({
              ...idx,
              id: crypto.randomUUID(),
              fieldIds: idx.fieldIds.map((fid) => fieldIdMap.get(fid) ?? fid),
            })),
          });
        } else if (node.type === "zone") {
          const zones = getZonesMap(doc);
          const src = node.data.zone;
          const id = crypto.randomUUID();
          zones.set(id, { ...src, id, position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET } });
        } else if (node.type === "sticky") {
          const stickyNotes = getStickyNotesMap(doc);
          const src = node.data.note;
          const id = crypto.randomUUID();
          stickyNotes.set(id, { ...src, id, position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET } });
        } else if (node.type === "enum") {
          const enums = getEnumsMap(doc);
          const src = node.data.enumDef;
          const id = crypto.randomUUID();
          enums.set(id, {
            ...src,
            id,
            name: `${src.name}_copy`,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
            values: src.values.map((v) => ({ ...v, id: crypto.randomUUID() })),
          });
        }
      }
    });
  }, [doc, nodes]);

  const onEdgesDelete = useCallback(
    (deletedEdges: RefEdgeType[]) => {
      if (!doc) return;
      const refs = getRefsMap(doc);
      doc.transact(() => {
        for (const edge of deletedEdges) {
          if (refs.has(edge.id)) {
            refs.delete(edge.id);
          }
        }
      });
    },
    [doc],
  );

  // A handle id is either `${fieldId}-left|right-source|target` for a field
  // row, or `header-left|right-source|target` for the table-header handle
  // (the only one rendered when the table is collapsed to "compact"). The
  // header handle has no specific field behind it, so it resolves to the
  // table's primary key — falling back to its first field — as the ref's
  // actual endpoint.
  const resolveConnectionField = useCallback(
    (tableId: string, handleId: string): string | null => {
      const table = liveProject?.tables.find((t) => t.id === tableId);
      if (!table) return null;
      const fieldId = handleId.replace(/-(left|right)-(source|target)$/, "");
      if (fieldId !== "header") return fieldId;
      return (table.fields.find((f) => f.pk) ?? table.fields[0])?.id ?? null;
    },
    [liveProject],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!doc || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return;
      }
      const fromFieldId = resolveConnectionField(connection.source, connection.sourceHandle);
      const toFieldId = resolveConnectionField(connection.target, connection.targetHandle);
      if (!fromFieldId || !toFieldId) return;
      // A field can't be its own foreign key.
      if (connection.source === connection.target && fromFieldId === toFieldId) return;

      const refs = getRefsMap(doc);
      const id = crypto.randomUUID();
      refs.set(id, {
        id,
        from: { tableId: connection.source, fieldId: fromFieldId },
        to: { tableId: connection.target, fieldId: toFieldId },
        cardinality: "one-to-many",
      });
    },
    [doc, resolveConnectionField],
  );

  return {
    addTable,
    addZone,
    addStickyNote,
    addEnum,
    groupSelectedTables,
    setAllDetailLevels,
    activeDetailLevel,
    autoLayout,
    setTablesColor,
    duplicateSelected,
    onEdgesDelete,
    onConnect,
  };
}
