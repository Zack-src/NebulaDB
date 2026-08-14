import * as Y from "yjs";
import {
  getRefsMap,
  getTablesMap,
  type Comment,
  type Field,
  type Table,
  type TableIndex,
} from "@athanordb/shared";
import type { TableNodeType } from "@/features/editor/nodes/TableNode";

export function buildTableNodes(
  tables: Table[],
  doc: Y.Doc,
  refFieldIdsByTable: Map<string, Set<string>>,
  user: string,
  highlightLinks: boolean,
  palette: string[],
  onPaletteChange: (next: string[]) => void,
  onGoToDbml: (tableName: string) => void,
  canWrite = true,
): TableNodeType[] {
  return tables.map((table) => ({
    id: table.id,
    position: table.position,
    type: "table",
    data: {
      table,
      refFieldIds: refFieldIdsByTable.get(table.id) ?? new Set(),
      highlightLinks,
      currentUser: user,
      palette,
      readOnly: !canWrite,
      onPaletteChange,
      onGoToDbml: () => onGoToDbml(table.name),
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
        const comment: Comment = { id: crypto.randomUUID(), author: user, text, createdAt: new Date().toISOString(), fieldId };
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
      ...(!canWrite ? {} : {
      onUpdateField: (fieldId: string, updates: Partial<Field>) => {
        const tables_ = getTablesMap(doc);
        const current = tables_.get(table.id);
        if (!current) return;
        const updatedFields = current.fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f));
        tables_.set(table.id, { ...current, fields: updatedFields });
      },
      onAddField: (fieldData: Omit<Field, "id">) => {
        const tables_ = getTablesMap(doc);
        const current = tables_.get(table.id);
        if (!current) return;
        const newField: Field = { id: crypto.randomUUID(), ...fieldData };
        tables_.set(table.id, { ...current, fields: [...current.fields, newField] });
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
        const newIndex: TableIndex = { id: crypto.randomUUID(), fieldIds, unique: opts.unique, pk: opts.pk, name: opts.name };
        doc.transact(() => {
          const fields = opts.pk ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f)) : current.fields;
          const indexes = opts.pk ? current.indexes.map((idx) => (idx.pk ? { ...idx, pk: false } : idx)) : current.indexes;
          tables_.set(table.id, { ...current, fields, indexes: [...indexes, newIndex] });
        });
      },
      onUpdateIndex: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => {
        const tables_ = getTablesMap(doc);
        const current = tables_.get(table.id);
        if (!current) return;
        doc.transact(() => {
          const fields = updates.pk ? current.fields.map((f) => (f.pk ? { ...f, pk: false } : f)) : current.fields;
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
  }));
}
