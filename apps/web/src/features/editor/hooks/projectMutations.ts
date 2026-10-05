import * as Y from "yjs";
import type { Connection } from "@xyflow/svelte";
import {
  defaultDetailLevelForNewTable,
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTablesMap,
  getZonesMap,
  isRefInverted,
  reverseRef,
  type DetailLevel,
  type Project,
} from "@athanordb/shared";
import type { CanvasNode } from "@/types/index";
import { generateId } from "@/utils/id";
import {
  clipboardSize,
  instantiateClipboard,
  uniqueCopyName,
  type PasteTarget,
  type CanvasClipboard,
} from "@/features/editor/canvas/tableClipboard";

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
  /** Table locks, mirrored: a relation belongs to the table that carries its foreign key. */
  locks: {
    frozenTableIds?: () => ReadonlySet<string>;
    /** A relation was left alone, or not drawn, because this table is locked. */
    onLockedRelation?: (tableName: string) => void;
  } = {},
) {
  const frozenCarrier = (tableId: string): string | null => {
    if (!locks.frozenTableIds?.().has(tableId)) return null;
    return liveProject()?.tables.find((table) => table.id === tableId)?.name ?? tableId;
  };

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

  // Figma-style grouping (select 2+ tables, group them) is
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
    // Shared across the loop so duplicating `a` twice — or `a` and `a_copy`
    // together — never yields two tables with the same name.
    const takenNames = new Set([...getTablesMap(current).values()].map((table) => table.name.toLowerCase()));
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
            name: uniqueCopyName(src.name, takenNames),
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

  /**
   * Adds copied elements (see `tableClipboard.ts`) in one undoable step; returns how many landed.
   * Every pasted table is a new, unlocked one, and a relation only ever joins two pasted tables,
   * so no lock is touched.
   */
  const pasteElements = (clipboard: CanvasClipboard, target: PasteTarget): number => {
    const current = doc();
    if (!current) return 0;
    const tables = getTablesMap(current);
    const enums = getEnumsMap(current);
    const pasted = instantiateClipboard(
      clipboard,
      { tables: [...tables.values()], enums: [...enums.values()] },
      target,
      generateId,
    );
    current.transact(() => {
      for (const table of pasted.tables) tables.set(table.id, table);
      const refs = getRefsMap(current);
      for (const ref of pasted.refs) refs.set(ref.id, ref);
      for (const entry of pasted.enums) enums.set(entry.id, entry);
      const zones = getZonesMap(current);
      for (const zone of pasted.zones) zones.set(zone.id, zone);
      const notes = getStickyNotesMap(current);
      for (const note of pasted.stickyNotes) notes.set(note.id, note);
    });
    return clipboardSize(pasted);
  };

  const deleteEdges = (edgeIds: string[]) => {
    const current = doc();
    if (!current) return;
    const refs = getRefsMap(current);
    let lockedTable: string | null = null;
    current.transact(() => {
      for (const id of edgeIds) {
        const ref = refs.get(id);
        if (!ref) continue;
        const carrier = frozenCarrier(ref.from.tableId);
        if (carrier) lockedTable = carrier;
        else refs.delete(id);
      }
    });
    if (lockedTable) locks.onLockedRelation?.(lockedTable);
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
    const drawn = {
      id,
      from: { tableId: connection.source, fieldId: fromFieldId },
      to: { tableId: connection.target, fieldId: toFieldId },
      cardinality: "one-to-many" as const,
    };
    // A ref's `from` is the foreign-key column, whichever way the user
    // dragged: from `posts.author_id` to `users.id`, or from `users.id` (a
    // key) to `posts.author_id`. When the drag clearly went key → plain
    // column, store it the right way round instead of making them reverse it.
    const tablesById = new Map((liveProject()?.tables ?? []).map((table) => [table.id, table]));
    const ref = isRefInverted(drawn, tablesById) ? reverseRef(drawn) : drawn;
    // Drawing a relation adds a foreign key to the table it starts from: not onto a locked one.
    const carrier = frozenCarrier(ref.from.tableId);
    if (carrier) {
      locks.onLockedRelation?.(carrier);
      return;
    }
    getRefsMap(current).set(id, ref);
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
    pasteElements,
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
