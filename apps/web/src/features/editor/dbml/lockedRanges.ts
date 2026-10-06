import { EditorState, Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { documentSync, harmlessRewrite } from "@/features/editor/dbml/annotations";
import { getSymbols } from "@/features/editor/dbml/symbols";

/**
 * Locked tables in the DBML buffer: the `Table ... { ... }` block of a table whose lock binds
 * this user can't be typed into. The server would refuse the sync anyway, but only after the
 * edit left a buffer that no longer matches the schema. A standalone `Ref:` line isn't frozen:
 * which table carries a relation is the server's to decide.
 */
const NO_TABLES: ReadonlySet<string> = new Set();

/** Names (lower-case) of the tables this user may not alter. */
const setFrozenTables = StateEffect.define<ReadonlySet<string>>();

const frozenTablesField = StateField.define<ReadonlySet<string>>({
  create: () => NO_TABLES,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFrozenTables)) return effect.value;
    return value;
  },
});

/** Told which table an edit was refused for. */
export const onLockedEdit = Facet.define<(tableName: string) => void>();

interface FrozenRange {
  name: string;
  from: number;
  to: number;
}

function frozenRanges(state: EditorState): FrozenRange[] {
  const frozen = state.field(frozenTablesField, false) ?? NO_TABLES;
  if (frozen.size === 0) return [];
  const lines = state.doc.lines;
  return getSymbols(state)
    .tables.filter((table) => frozen.has(table.name.toLowerCase()))
    .map((table) => ({
      name: table.name,
      from: state.doc.line(Math.min(Math.max(1, table.line), lines)).from,
      to: state.doc.line(Math.min(Math.max(1, table.endLine), lines)).to,
    }));
}

const guard = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(documentSync) || tr.annotation(harmlessRewrite)) return true;
  const ranges = frozenRanges(tr.startState);
  if (ranges.length === 0) return true;
  let hit: FrozenRange | undefined;
  tr.changes.iterChangedRanges((from, to) => {
    // Typing right before `Table` or right after the closing brace is outside the block.
    hit ??= ranges.find((range) =>
      from === to ? from > range.from && from < range.to : from < range.to && to > range.from,
    );
  });
  if (!hit) return true;
  const { name } = hit;
  // After this transaction is settled: a listener may show a message, which must not happen mid-dispatch.
  queueMicrotask(() => {
    for (const listener of tr.startState.facet(onLockedEdit)) listener(name);
  });
  return false;
});

const lockedLine = Decoration.line({ class: "cm-lockedLine" });

const decorations = EditorView.decorations.compute([frozenTablesField, "doc"], (state): DecorationSet => {
  const marks = [];
  for (const range of frozenRanges(state)) {
    const last = state.doc.lineAt(range.to).number;
    for (let line = state.doc.lineAt(range.from).number; line <= last; line++) {
      marks.push(lockedLine.range(state.doc.line(line).from));
    }
  }
  return Decoration.set(marks, true);
});

const theme = EditorView.baseTheme({
  ".cm-lockedLine": {
    backgroundColor: "color-mix(in srgb, var(--color-locked, #b45309) 9%, transparent)",
    boxShadow: "inset 2px 0 0 var(--color-locked, #b45309)",
  },
});

export const lockedTables: Extension = [frozenTablesField, guard, decorations, theme];

/** Hands the editor the tables this user may not alter. */
export function applyFrozenTables(view: EditorView, names: ReadonlySet<string>) {
  view.dispatch({ effects: setFrozenTables.of(names) });
}
