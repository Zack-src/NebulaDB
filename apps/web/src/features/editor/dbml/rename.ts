import { Facet, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { getSymbols, tableAt, unquoteIdent, type Span } from "@/features/editor/dbml/symbols";
import { tokenAt } from "@/features/editor/dbml/navigation";

export interface RenameRequest {
  kind: "table" | "column" | "enum";
  name: string;
  /** owning table, for a column rename */
  owner?: string;
  span: Span;
  /** number of places the rename will touch, declaration included */
  occurrences: number;
}

/** The panel installs a handler here so F2 can open the rename input. */
export const renameHandler = Facet.define<(request: RenameRequest) => void>();

/** What would be renamed at `pos`, or null when the symbol under the cursor isn't renameable. */
export function prepareRename(state: EditorState, pos: number): RenameRequest | null {
  const symbols = getSymbols(state);
  const line = state.doc.lineAt(pos);
  const tok = tokenAt(line.text, pos - line.from);
  if (!tok) return null;
  const span: Span = { from: line.from + tok.from, to: line.from + tok.to };
  const name = unquoteIdent(tok.text);
  const before = line.text.slice(0, tok.from).trimEnd();

  // qualified column: `Table.column`
  if (before.endsWith(".")) {
    const ownerTok = tokenAt(line.text, before.length - 2);
    const owner = ownerTok && symbols.tableByName.get(unquoteIdent(ownerTok.text).toLowerCase());
    if (owner?.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      return withCount(state, { kind: "column", name, owner: owner.name, span, occurrences: 0 });
    }
  }

  // a column declaration line inside the enclosing table wins over a same-named table
  const owner = tableAt(symbols, state.doc, pos);
  const declaredHere = owner?.fields.find((f) => f.nameSpan.from === span.from);
  if (owner && declaredHere) {
    return withCount(state, { kind: "column", name: declaredHere.name, owner: owner.name, span, occurrences: 0 });
  }

  const table = symbols.tableByName.get(name.toLowerCase());
  if (table && table.name.toLowerCase() === name.toLowerCase()) {
    return withCount(state, { kind: "table", name: table.name, span, occurrences: 0 });
  }

  if (symbols.enumByName.has(name.toLowerCase())) {
    return withCount(state, { kind: "enum", name, span, occurrences: 0 });
  }

  if (owner?.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return withCount(state, { kind: "column", name, owner: owner.name, span, occurrences: 0 });
  }

  return null;
}

function withCount(state: EditorState, request: RenameRequest): RenameRequest {
  return { ...request, occurrences: renameChanges(state, request, request.name).length };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every edit needed to rename `request` to `newName`, across declarations, relationships, groups and indexes. */
export function renameChanges(state: EditorState, request: RenameRequest, newName: string): ChangeSpec[] {
  const symbols = getSymbols(state);
  const changes: ChangeSpec[] = [];
  const insert = /^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) ? newName : `"${newName.replace(/"/g, "")}"`;
  const at = (span: Span) => changes.push({ from: span.from, to: span.to, insert });

  if (request.kind === "table") {
    const table = symbols.tableByName.get(request.name.toLowerCase());
    if (!table) return changes;
    at(table.nameSpan);
    for (const ref of symbols.refs) {
      for (const endpoint of [ref.left, ref.right]) {
        if (same(endpoint.table, table.name) || (table.alias && same(endpoint.table, table.alias))) at(endpoint.tableSpan);
      }
    }
    for (const group of symbols.groups) {
      for (const member of group.members) if (same(member.name, table.name)) at(member.span);
    }
    for (const other of symbols.tables) {
      for (const field of other.fields) {
        for (const inline of field.inlineRefs) if (same(inline.table, table.name)) at(inline.tableSpan);
      }
    }
    return changes;
  }

  if (request.kind === "enum") {
    const sym = symbols.enumByName.get(request.name.toLowerCase());
    if (!sym) return changes;
    at(sym.nameSpan);
    for (const table of symbols.tables) {
      for (const field of table.fields) {
        if (same(field.type.replace(/\(.*$/, ""), sym.name)) at(field.typeSpan);
      }
    }
    return changes;
  }

  // column
  const owner = symbols.tableByName.get((request.owner ?? "").toLowerCase());
  if (!owner) return changes;
  const field = owner.fields.find((f) => same(f.name, request.name));
  if (!field) return changes;
  at(field.nameSpan);

  for (const ref of symbols.refs) {
    for (const endpoint of [ref.left, ref.right]) {
      const endpointTable = symbols.tableByName.get(endpoint.table.toLowerCase());
      if (endpointTable !== owner) continue;
      if (endpoint.fields.length === 1 && same(endpoint.fields[0], field.name) && endpoint.fieldSpan.to > endpoint.fieldSpan.from) {
        at(endpoint.fieldSpan);
      }
    }
  }

  for (const table of symbols.tables) {
    for (const other of table.fields) {
      for (const inline of other.inlineRefs) {
        const target = symbols.tableByName.get(inline.table.toLowerCase());
        if (target === owner && same(inline.field, field.name)) at(inline.fieldSpan);
      }
    }
  }

  // occurrences inside the table's own `indexes { }` block
  const indexRe = new RegExp(`\\b${field.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  for (let n = owner.line; n <= owner.endLine; n++) {
    const line = state.doc.line(n);
    if (!/^\s*\(|^\s*"?\w+"?\s*(\[|$)/.test(line.text)) continue;
    if (n === field.line) continue;
    if (!/[(),]/.test(line.text)) continue;
    let m: RegExpExecArray | null;
    indexRe.lastIndex = 0;
    while ((m = indexRe.exec(line.text))) {
      at({ from: line.from + m.index, to: line.from + m.index + m[0].length });
    }
  }

  return changes;
}

export function applyRename(view: EditorView, request: RenameRequest, newName: string): boolean {
  const changes = renameChanges(view.state, request, newName);
  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/** F2 — hands the symbol under the cursor to the panel's rename input. */
export const startRename: Command = (view) => {
  const request = prepareRename(view.state, view.state.selection.main.head);
  if (!request) return false;
  const handler = view.state.facet(renameHandler)[0];
  if (!handler) return false;
  handler(request);
  return true;
};
