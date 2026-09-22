import * as Y from "yjs";
import type { Connection } from "@xyflow/svelte";
import {
  defaultDetailLevelForNewTable,
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTablesMap,
  getZonesMap,
  type DetailLevel,
  type Project,
} from "@athanordb/shared";
import type { CanvasNode } from "@/types/index";
import { generateId } from "@/utils/id";

/**
 * Every doc-mutating action the project toolbar/canvas can trigger — add/
 * duplicate elements, connect/delete refs, bulk detail-level and colour
 * changes. Plain functions over getters: each reads the project, doc and
 * nodes as they are *at call time*, so none of them has to be re-created (or
 * re-passed down the tree) when any of those change.
 */
export function createProjectMutations(
  liveProject: () => Project | null,
  /** Null for a read-only grant — every mutator below then no-ops. */
  doc: () => Y.Doc | null,
  nodes: () => CanvasNode[],
) {
  const addTable = (position?: { x: number; y: number }) => {
    const current = doc();
    if (!current) return;
    const tables = getTablesMap(current);
    const id = generateId();
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
      fields: [{ id: generateId(), name: "id", type: "int", pk: true, increment: true }],
      indexes: [],
      position: position ?? { x: (index % 6) * 260, y: Math.floor(index / 6) * 200 },
      detailLevel: defaultDetailLevelForNewTable(liveProject()?.tables ?? []),
    });
  };

  const addZone = (position?: { x: number; y: number }) => {
    const current = doc();
    if (!current) return;
    const id = generateId();
    getZonesMap(current).set(id, {
      id,
      label: "Zone",
      position: position ?? { x: 40, y: 40 },
      size: { width: 300, height: 220 },
      style: { color: "#f59e0b" },
    });
  };

  const addStickyNote = (position?: { x: number; y: number }) => {
    const current = doc();
    if (!current) return;
    const id = generateId();
    getStickyNotesMap(current).set(id, {
      id,
      text: "",
      position: position ?? { x: 60, y: 60 },
      size: { width: 160, height: 120 },
      style: { color: "#fef08a" },
    });
  };

  const addEnum = (position?: { x: number; y: number }) => {
    const current = doc();
    if (!current) return;
    const enums = getEnumsMap(current);
    const id = generateId();
    const index = enums.size;
    enums.set(id, {
      id,
      name: `enum_${index + 1}`,
      values: [{ id: generateId(), name: "value_1" }],
      position: position ?? { x: 40, y: 40 },
    });
  };

  // Figma-style grouping (select 2+ tables, group them) and auto-layout are
  // the `athanordb.core-canvas` plugin's canvasCommands (see coreCanvas.ts),
  // not plain doc mutations here — consistent with how every other
  // schema-transform command in the app is wired.

  const setAllDetailLevels = (level: DetailLevel) => {
    const current = doc();
    if (!current) return;
    const tables = getTablesMap(current);
    // One transaction, not one `set()` per table: each `set()` is its own Yjs
    // transaction, and every one of those rebuilt the *entire* project (and
    // re-rendered the whole canvas) — N full rebuilds for a single click,
    // enough to hang the tab on compact→full with many tables.
    current.transact(() => {
      tables.forEach((table, id) => tables.set(id, { ...table, detailLevel: level }));
    });
  };

  const setTablesColor = (tableIds: string[], color: string) => {
    const current = doc();
    if (!current || tableIds.length === 0) return;
    const tables = getTablesMap(current);
    current.transact(() => {
      for (const id of tableIds) {
        const table = tables.get(id);
        if (table) tables.set(id, { ...table, style: { ...table.style, color } });
      }
    });
  };

  /** Rewrites `field.type` for a batch of fields in one Yjs transaction — the "Convert types" project-wide action's write path (see `ConvertTypesModal`). */
  const convertFieldTypes = (changes: { tableId: string; fieldId: string; newType: string }[]) => {
    const current = doc();
    if (!current || changes.length === 0) return;
    const tables = getTablesMap(current);
    current.transact(() => {
      for (const { tableId, fieldId, newType } of changes) {
        const table = tables.get(tableId);
        if (!table) continue;
        tables.set(tableId, {
          ...table,
          fields: table.fields.map((f) => (f.id === fieldId ? { ...f, type: newType } : f)),
        });
      }
    });
  };

  const duplicateSelected = () => {
    const current = doc();
    if (!current) return;
    const selected = nodes().filter((n) => n.selected);
    if (selected.length === 0) return;
    const OFFSET = 24;
    current.transact(() => {
      for (const node of selected) {
        if (node.type === "table") {
          const tables = getTablesMap(current);
          // The true doc row, not `node.data.table`: on a large schema the
          // canvas renders every table's `detailLevel` forced to "compact"
          // regardless of its real setting (see `ProjectEditor`'s
          // `renderProject`), so the rendered node's own data can't be
          // trusted as the source for a write — duplicating a "full" table
          // would otherwise silently downgrade the copy to "compact".
          const src = tables.get(node.id) ?? node.data.table;
          const fieldIdMap = new Map(src.fields.map((f) => [f.id, generateId()]));
          const id = generateId();
          tables.set(id, {
            ...src,
            id,
            name: `${src.name}_copy`,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
            fields: src.fields.map((f) => ({ ...f, id: fieldIdMap.get(f.id)! })),
            indexes: src.indexes.map((idx) => ({
              ...idx,
              id: generateId(),
              fieldIds: idx.fieldIds.map((fid) => fieldIdMap.get(fid) ?? fid),
            })),
          });
        } else if (node.type === "zone") {
          const src = node.data.zone;
          const id = generateId();
          getZonesMap(current).set(id, {
            ...src,
            id,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
          });
        } else if (node.type === "sticky") {
          const src = node.data.note;
          const id = generateId();
          getStickyNotesMap(current).set(id, {
            ...src,
            id,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
          });
        } else if (node.type === "enum") {
          const src = node.data.enumDef;
          const id = generateId();
          getEnumsMap(current).set(id, {
            ...src,
            id,
            name: `${src.name}_copy`,
            position: { x: src.position.x + OFFSET, y: src.position.y + OFFSET },
            values: src.values.map((v) => ({ ...v, id: generateId() })),
          });
        }
      }
    });
  };

  const deleteEdges = (edgeIds: string[]) => {
    const current = doc();
    if (!current) return;
    const refs = getRefsMap(current);
    current.transact(() => {
      for (const id of edgeIds) if (refs.has(id)) refs.delete(id);
    });
  };

  // A handle id is either `${fieldId}-left|right-source|target` for a field
  // row, or `header-left|right-source|target` for the table-header handle
  // (the only one rendered when the table is collapsed to "compact"). The
  // header handle has no specific field behind it, so it resolves to the
  // table's primary key — falling back to its first field — as the ref's
  // actual endpoint.
  const resolveConnectionField = (tableId: string, handleId: string): string | null => {
    const table = liveProject()?.tables.find((t) => t.id === tableId);
    if (!table) return null;
    const fieldId = handleId.replace(/-(left|right)-(source|target)$/, "");
    if (fieldId !== "header") return fieldId;
    return (table.fields.find((f) => f.pk) ?? table.fields[0])?.id ?? null;
  };

  const onConnect = (connection: Connection) => {
    const current = doc();
    if (!current || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      return;
    }
    const fromFieldId = resolveConnectionField(connection.source, connection.sourceHandle);
    const toFieldId = resolveConnectionField(connection.target, connection.targetHandle);
    if (!fromFieldId || !toFieldId) return;
    // A field can't be its own foreign key.
    if (connection.source === connection.target && fromFieldId === toFieldId) return;

    const id = generateId();
    getRefsMap(current).set(id, {
      id,
      from: { tableId: connection.source, fieldId: fromFieldId },
      to: { tableId: connection.target, fieldId: toFieldId },
      cardinality: "one-to-many",
    });
  };

  return {
    addTable,
    addZone,
    addStickyNote,
    addEnum,
    setAllDetailLevels,
    setTablesColor,
    convertFieldTypes,
    duplicateSelected,
    deleteEdges,
    onConnect,
  };
}

/** Highlights a detail-level button only when every table currently shares that level — once tables diverge (e.g. per-table override), no button is "active". */
export function activeDetailLevelOf(project: Project | null): DetailLevel | null {
  const tables = project?.tables ?? [];
  if (tables.length === 0) return null;
  const [first, ...rest] = tables;
  return rest.every((t) => t.detailLevel === first.detailLevel) ? first.detailLevel : null;
}
