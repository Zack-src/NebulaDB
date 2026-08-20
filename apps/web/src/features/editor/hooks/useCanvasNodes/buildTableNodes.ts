import * as Y from "yjs";
import { getRefsMap, getTablesMap, type Comment, type Field, type Table, type TableIndex } from "@athanordb/shared";
import type { TableNodeType } from "@/features/editor/nodes/TableNode";
import { generateId } from "@/utils/id";
import { readCachedTableNode, type TableNodeCache } from "./tableNodeCache";

export function buildTableNodes(
  tables: Table[],
  doc: Y.Doc,
  refFieldIdsByTable: Map<string, Set<string>>,
  user: string,
  palette: string[],
  onPaletteChange: (next: string[]) => void,
  onGoToDbml: (tableName: string) => void,
  onFieldHoverChange: (fieldId: string | null) => void,
  onTableHoverChange: (tableId: string | null) => void,
  selectedFieldId: string | null,
  onSelectField: (fieldId: string | null) => void,
  canWrite = true,
  /**
   * Per-table memo of the last node built for each id — see
   * `tableNodeCache.ts`. Rebuilding every table's data (and its fifteen
   * closures) on every doc update is the difference between "one column
   * changed" and "reallocate the whole canvas".
   */
  cache: TableNodeCache = new Map(),
): TableNodeType[] {
  // Callbacks are all stable across a rebuild by construction (the hook wraps
  // them), so one identity stands in for the whole bundle in the cache key.
  const callbacks = onSelectField;
  const nodes = tables.map((table) => {
    const refFieldIds = refFieldIdsByTable.get(table.id) ?? EMPTY_FIELD_IDS;
    // The per-table slice of the column selection: a selection landing on some
    // *other* table must not invalidate this one.
    const selectedFieldIdForTable =
      selectedFieldId && table.fields.some((field) => field.id === selectedFieldId) ? selectedFieldId : null;
    const cacheKey = {
      table,
      refFieldIds,
      selectedFieldId: selectedFieldIdForTable,
      palette,
      canWrite,
      user,
      callbacks,
    };
    const cached = readCachedTableNode(cache, cacheKey, table.id);
    if (cached) return cached;

    const node = buildTableNode(table, refFieldIds, selectedFieldIdForTable);
    cache.set(table.id, { ...cacheKey, node });
    return node;
  });

  // Tables that no longer exist would otherwise pin their node (and the whole
  // `Table` object behind it) in the cache forever.
  if (cache.size > tables.length) {
    const live = new Set(tables.map((table) => table.id));
    for (const id of cache.keys()) {
      if (!live.has(id)) cache.delete(id);
    }
  }
  return nodes;

  function buildTableNode(table: Table, refFieldIds: Set<string>, selectedFieldId: string | null): TableNodeType {
    return {
      id: table.id,
      position: table.position,
      type: "table",
      data: {
        table,
        refFieldIds,
        currentUser: user,
        palette,
        readOnly: !canWrite,
        selectedFieldId,
        onSelectField,
        onPaletteChange,
        onGoToDbml: () => onGoToDbml(table.name),
        // Purely visual (no doc write), so unlike the mutators below it is never
        // gated on `canWrite` — a view-only session still gets to see which
        // relation a column belongs to.
        onFieldHoverChange,
        onTableHoverChange,
        onRename: (name: string) => {
          const tables_ = getTablesMap(doc);
          const current = tables_.get(table.id);
          if (current) tables_.set(table.id, { ...current, name });
        },
        onStyleChange: (color?: string, borderColor?: string) => {
          const tables_ = getTablesMap(doc);
          const current = tables_.get(table.id);
          if (current) tables_.set(table.id, { ...current, style: { color, borderColor } });
        },
        onAddComment: (text: string, fieldId?: string) => {
          const tables_ = getTablesMap(doc);
          const current = tables_.get(table.id);
          if (!current) return;
          const comment: Comment = {
            id: generateId(),
            author: user,
            text,
            createdAt: new Date().toISOString(),
            fieldId,
          };
          tables_.set(table.id, { ...current, comments: [...(current.comments ?? []), comment] });
        },
        onDeleteComment: (commentId: string) => {
          const tables_ = getTablesMap(doc);
          const current = tables_.get(table.id);
          if (!current) return;
          tables_.set(table.id, { ...current, comments: (current.comments ?? []).filter((c) => c.id !== commentId) });
        },
        // Every callback below is omitted outright for a read-only grant: the
        // node components already treat an absent handler as "don't offer this",
        // so the affordances disappear rather than becoming buttons whose writes
        // the server throws away.
        ...(!canWrite
          ? {}
          : {
              // `updates` may be an updater function so a toggle (`pk: !field.pk`)
              // is computed from the field as it is in the doc *right now*, not
              // from whatever value was current when the popover last rendered.
              // Spam-clicking a toggle fires several of these synchronously
              // before React/Yjs can re-render the popover in between, so a
              // plain `!field.pk` closed over stale props would flip back and
              // forth off the same stale value instead of advancing each click.
              onUpdateField: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => {
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                const updatedFields = current.fields.map((f) => {
                  if (f.id !== fieldId) return f;
                  const patch = typeof updates === "function" ? updates(f) : updates;
                  return { ...f, ...patch };
                });
                tables_.set(table.id, { ...current, fields: updatedFields });
              },
              onAddField: (fieldData: Omit<Field, "id">) => {
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                const newField: Field = { id: generateId(), ...fieldData };
                tables_.set(table.id, { ...current, fields: [...current.fields, newField] });
              },
              // Drag-reorder: `before` says which side of `targetFieldId` the
              // dragged field lands on. Removing first and re-finding the
              // target's index in the shortened array (rather than doing the
              // math against the original index) keeps this correct whether
              // the field moves up or down the list.
              onReorderField: (draggedFieldId: string, targetFieldId: string, before: boolean) => {
                if (draggedFieldId === targetFieldId) return;
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                const fields = [...current.fields];
                const fromIndex = fields.findIndex((f) => f.id === draggedFieldId);
                if (fromIndex === -1) return;
                const [moved] = fields.splice(fromIndex, 1);
                const targetIndex = fields.findIndex((f) => f.id === targetFieldId);
                if (targetIndex === -1) return;
                fields.splice(before ? targetIndex : targetIndex + 1, 0, moved);
                tables_.set(table.id, { ...current, fields });
              },
              onDeleteField: (fieldId: string) => {
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
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
                  tables_.set(table.id, { ...current, fields: updatedFields });
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
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                const newIndex: TableIndex = {
                  id: generateId(),
                  fieldIds,
                  unique: opts.unique,
                  pk: opts.pk,
                  name: opts.name,
                };
                doc.transact(() => {
                  const fields = opts.pk ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f)) : current.fields;
                  const indexes = opts.pk
                    ? current.indexes.map((idx) => (idx.pk ? { ...idx, pk: false } : idx))
                    : current.indexes;
                  tables_.set(table.id, { ...current, fields, indexes: [...indexes, newIndex] });
                });
              },
              onUpdateIndex: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => {
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                doc.transact(() => {
                  const fields = updates.pk
                    ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f))
                    : current.fields;
                  const indexes = current.indexes.map((idx) => {
                    if (idx.id === indexId) return { ...idx, ...updates };
                    return updates.pk && idx.pk ? { ...idx, pk: false } : idx;
                  });
                  tables_.set(table.id, { ...current, fields, indexes });
                });
              },
              onDeleteIndex: (indexId: string) => {
                const tables_ = getTablesMap(doc);
                const current = tables_.get(table.id);
                if (!current) return;
                tables_.set(table.id, { ...current, indexes: current.indexes.filter((idx) => idx.id !== indexId) });
              },
            }),
      },
    };
  }
}

/** Shared empty set for tables with no relations — one allocation, not one per table per rebuild. */
const EMPTY_FIELD_IDS: Set<string> = new Set();
