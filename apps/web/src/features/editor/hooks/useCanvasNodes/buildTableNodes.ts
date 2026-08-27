import * as Y from "yjs";
import {
  getRefsMap,
  getTablesMap,
  type Comment,
  type Field,
  type Ref,
  type RefAction,
  type Table,
  type TableIndex,
} from "@athanordb/shared";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import type { TableNodeType } from "@/features/editor/nodes/TableNode";
import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";
import { generateId } from "@/utils/id";
import { readCachedTableNode, type TableNodeCache } from "./tableNodeCache";

const EMPTY_ISSUES: ValidationIssue[] = [];

export function buildTableNodes(
  tables: Table[],
  refs: Ref[],
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
  /** This table's own validation issues (see `packages/dbml-engine/src/validate.ts`), from `ProjectEditor`'s `issuesByTable`. */
  issuesByTable: Map<string, ValidationIssue[]> = new Map(),
  /** The canvas-wide "show validation issues" toggle — see `CanvasToolbar`. */
  showValidationIssues = true,
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

  // Name lookups for `FieldRefInfo.toLabel` — built once for the whole rebuild
  // rather than per table/field, same reasoning as everything else here.
  const tableNameById = new Map(tables.map((t) => [t.id, t.name]));
  const fieldNameByKey = new Map<string, string>();
  for (const t of tables) for (const f of t.fields) fieldNameByKey.set(`${t.id}.${f.id}`, f.name);

  const nodes = tables.map((table) => {
    const refFieldIds = refFieldIdsByTable.get(table.id) ?? EMPTY_FIELD_IDS;
    // The per-table slice of the column selection: a selection landing on some
    // *other* table must not invalidate this one.
    const selectedFieldIdForTable =
      selectedFieldId && table.fields.some((field) => field.id === selectedFieldId) ? selectedFieldId : null;
    const issues = issuesByTable.get(table.id) ?? EMPTY_ISSUES;
    // `issuesByTable` is rebuilt (fresh array per table) on every project
    // change like `refFieldIdsByTable` above — a joined string, not the array
    // itself, is what the cache can actually compare with `===`.
    const issuesKey = issues.map((issue) => `${issue.severity}:${issue.message}`).join("|");

    // Refs where this table is the FK ("from") side, grouped by field — what
    // `FieldEditorPopover` needs to offer ON DELETE/ON UPDATE on the column
    // itself. Joined into a string for the same reason `issuesKey` is: a fresh
    // Map every rebuild, so `readCachedTableNode` needs something comparable
    // by `===` rather than deep-diffing a Map every table on every rebuild.
    const fieldRefs = new Map<string, FieldRefInfo[]>();
    const fromRefs = refs.filter((r) => r.from.tableId === table.id);
    for (const r of fromRefs) {
      const toLabel = `${tableNameById.get(r.to.tableId) ?? r.to.tableId}.${fieldNameByKey.get(`${r.to.tableId}.${r.to.fieldId}`) ?? r.to.fieldId}`;
      const entry: FieldRefInfo = { refId: r.id, onDelete: r.onDelete, onUpdate: r.onUpdate, toLabel };
      const list = fieldRefs.get(r.from.fieldId);
      if (list) list.push(entry);
      else fieldRefs.set(r.from.fieldId, [entry]);
    }
    const refActionsKey = fromRefs.map((r) => `${r.id}:${r.onDelete ?? ""}:${r.onUpdate ?? ""}`).join("|");

    const cacheKey = {
      table,
      refFieldIds,
      selectedFieldId: selectedFieldIdForTable,
      palette,
      canWrite,
      user,
      callbacks,
      issuesKey,
      showValidationIssues,
      refActionsKey,
    };
    const cached = readCachedTableNode(cache, cacheKey, table.id);
    if (cached) return cached;

    const node = buildTableNode(table, refFieldIds, selectedFieldIdForTable, issues, fieldRefs, refActionsKey);
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

  function buildTableNode(
    table: Table,
    refFieldIds: Set<string>,
    selectedFieldId: string | null,
    issues: ValidationIssue[],
    fieldRefs: Map<string, FieldRefInfo[]>,
    refActionsKey: string,
  ): TableNodeType {
    return {
      id: table.id,
      position: table.position,
      type: "table",
      data: {
        table,
        refFieldIds,
        fieldRefs,
        // Lets `TableNode`'s memo comparator detect a ref action change without
        // deep-comparing `fieldRefs` itself — same pattern as `issuesKey`.
        refActionsKey,
        currentUser: user,
        palette,
        readOnly: !canWrite,
        selectedFieldId,
        issues: showValidationIssues ? issues : EMPTY_ISSUES,
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
              // Lets `FieldEditorPopover` set a ref's ON DELETE/ON UPDATE from the
              // FK column itself — same doc write `useCanvasEdges`' equivalent
              // handlers make from the relation's own edge popover, just reachable
              // from the other end.
              onUpdateRefAction: (refId: string, patch: { onDelete?: RefAction; onUpdate?: RefAction }) => {
                const refs_ = getRefsMap(doc);
                const current = refs_.get(refId);
                if (current) refs_.set(refId, { ...current, ...patch });
              },
            }),
      },
    };
  }
}

/** Shared empty set for tables with no relations — one allocation, not one per table per rebuild. */
const EMPTY_FIELD_IDS: Set<string> = new Set();
