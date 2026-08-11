import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type Command,
} from "@codemirror/view";
import { getSymbols, tableAt, unquoteIdent, type Span } from "@/features/editor/dbml/symbols";

const WORD = /[A-Za-z0-9_]/;

/** The identifier (optionally `"quoted"`) touching `pos` on `line`, or null. */
export function tokenAt(text: string, pos: number): { text: string; from: number; to: number } | null {
  // quoted identifier containing pos
  const quoted = /"[^"\n]+"/g;
  let q: RegExpExecArray | null;
  while ((q = quoted.exec(text))) {
    if (pos >= q.index && pos <= q.index + q[0].length) {
      return { text: q[0], from: q.index, to: q.index + q[0].length };
    }
  }
  const isWord = (ch: string | undefined) => Boolean(ch && WORD.test(ch));
  let at = pos;
  if (!isWord(text[at])) {
    if (isWord(text[at - 1])) at -= 1;
    else return null;
  }
  let from = at;
  let to = at + 1;
  while (from > 0 && isWord(text[from - 1])) from -= 1;
  while (to < text.length && isWord(text[to])) to += 1;
  return { text: text.slice(from, to), from, to };
}

export interface DefinitionTarget {
  /** document offset to jump to */
  pos: number;
  /** the clickable source range */
  span: Span;
  label: string;
}

/**
 * Resolves the symbol under `pos` to its declaration: `Table.field` endpoints,
 * bare table names (in `Ref` lines, `TableGroup` members or inline settings),
 * enum names used as a column type, and index members inside `indexes { }`.
 */
export function resolveDefinition(state: EditorState, pos: number): DefinitionTarget | null {
  const symbols = getSymbols(state);
  const line = state.doc.lineAt(pos);
  const tok = tokenAt(line.text, pos - line.from);
  if (!tok) return null;

  const span: Span = { from: line.from + tok.from, to: line.from + tok.to };
  const name = unquoteIdent(tok.text);
  const before = line.text.slice(0, tok.from).trimEnd();
  const afterChar = line.text.slice(tok.to).trimStart()[0];

  const jumpToTable = (tableName: string, fieldName?: string): DefinitionTarget | null => {
    const table = symbols.tableByName.get(tableName.toLowerCase());
    if (!table) return null;
    if (fieldName) {
      const field = table.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
      if (field) return { pos: field.nameSpan.from, span, label: `${table.name}.${field.name}` };
    }
    return { pos: table.nameSpan.from, span, label: table.name };
  };

  // `Table.field` — cursor on the field part
  if (before.endsWith(".")) {
    const ownerTok = tokenAt(line.text, before.length - 1 - 1);
    if (ownerTok) {
      const hit = jumpToTable(unquoteIdent(ownerTok.text), name);
      if (hit) return hit;
    }
  }

  // `Table.field` — cursor on the table part
  if (afterChar === ".") {
    const rest = tokenAt(line.text, line.text.indexOf(".", tok.to) + 1);
    const hit = jumpToTable(name, rest?.text ? unquoteIdent(rest.text) : undefined);
    if (hit) return hit;
  }

  const enumSym = symbols.enumByName.get(name.toLowerCase());
  const owner = tableAt(symbols, state.doc, pos);

  // a column's type that names an enum
  if (owner && enumSym) {
    const field = owner.fields.find((f) => f.line === line.number);
    if (field && field.type.replace(/\(.*$/, "").toLowerCase() === name.toLowerCase()) {
      return { pos: enumSym.nameSpan.from, span, label: enumSym.name };
    }
  }

  // a bare identifier: prefer a table, unless we're standing on its declaration
  const table = symbols.tableByName.get(name.toLowerCase());
  if (table && !(span.from >= table.nameSpan.from && span.to <= table.nameSpan.to)) {
    return { pos: table.nameSpan.from, span, label: table.name };
  }

  if (enumSym && !(span.from >= enumSym.nameSpan.from && span.to <= enumSym.nameSpan.to)) {
    return { pos: enumSym.nameSpan.from, span, label: enumSym.name };
  }

  // inside a table: an identifier that matches one of its own columns (e.g. in `indexes { }`)
  if (owner) {
    const field = owner.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (field && field.line !== line.number) {
      return { pos: field.nameSpan.from, span, label: `${owner.name}.${field.name}` };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Jump history (Alt+Left / Alt+Right)
// ---------------------------------------------------------------------------

const navPush = StateEffect.define<number>();
const navBackEffect = StateEffect.define<number>();
const navForwardEffect = StateEffect.define<number>();

interface NavState {
  back: number[];
  fwd: number[];
}

const MAX_NAV = 50;

const navField = StateField.define<NavState>({
  create: () => ({ back: [], fwd: [] }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(navPush)) {
        next = { back: [...next.back, e.value].slice(-MAX_NAV), fwd: [] };
      } else if (e.is(navBackEffect)) {
        next = { back: next.back.slice(0, -1), fwd: [...next.fwd, e.value].slice(-MAX_NAV) };
      } else if (e.is(navForwardEffect)) {
        next = { back: [...next.back, e.value].slice(-MAX_NAV), fwd: next.fwd.slice(0, -1) };
      }
    }
    if (tr.docChanged) {
      next = {
        back: next.back.map((p) => tr.changes.mapPos(p)),
        fwd: next.fwd.map((p) => tr.changes.mapPos(p)),
      };
    }
    return next;
  },
});

/** Moves the cursor to `pos`, centers it, and records the previous position in the jump history. */
export function jumpTo(view: EditorView, pos: number, opts: { select?: Span } = {}) {
  const current = view.state.selection.main.head;
  view.dispatch({
    selection: opts.select ? { anchor: opts.select.from, head: opts.select.to } : { anchor: pos },
    effects: [navPush.of(current), EditorView.scrollIntoView(pos, { y: "center" })],
    scrollIntoView: true,
  });
  view.focus();
}

export function jumpToLine(view: EditorView, lineNumber: number) {
  const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
  jumpTo(view, line.from, { select: { from: line.from, to: line.to } });
}

export const navigateBack: Command = (view) => {
  const nav = view.state.field(navField, false);
  if (!nav || nav.back.length === 0) return false;
  const target = nav.back[nav.back.length - 1];
  const current = view.state.selection.main.head;
  view.dispatch({
    selection: { anchor: Math.min(target, view.state.doc.length) },
    effects: [navBackEffect.of(current), EditorView.scrollIntoView(Math.min(target, view.state.doc.length), { y: "center" })],
  });
  return true;
};

export const navigateForward: Command = (view) => {
  const nav = view.state.field(navField, false);
  if (!nav || nav.fwd.length === 0) return false;
  const target = nav.fwd[nav.fwd.length - 1];
  const current = view.state.selection.main.head;
  view.dispatch({
    selection: { anchor: Math.min(target, view.state.doc.length) },
    effects: [navForwardEffect.of(current), EditorView.scrollIntoView(Math.min(target, view.state.doc.length), { y: "center" })],
  });
  return true;
};

/** F12 / Ctrl+click target under the cursor. */
export const goToDefinition: Command = (view) => {
  const target = resolveDefinition(view.state, view.state.selection.main.head);
  if (!target) return false;
  jumpTo(view, target.pos);
  return true;
};

// ---------------------------------------------------------------------------
// Ctrl-hover underline + Ctrl-click
// ---------------------------------------------------------------------------

const linkMark = Decoration.mark({ class: "cm-dbml-link" });
const setLinkRange = StateEffect.define<Span | null>();

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLinkRange)) {
        value = e.value ? Decoration.set([linkMark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Underlines the Ctrl/Cmd-clickable symbol under the pointer while the modifier is held. */
const ctrlLinkPlugin: Extension = ViewPlugin.fromClass(
  class {
    private coords: { x: number; y: number } | null = null;
    private shown: Span | null = null;

    constructor(readonly view: EditorView) {
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.clear);
    }

    onKey = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta" || event.ctrlKey || event.metaKey) {
        this.refresh(event.ctrlKey || event.metaKey);
      } else if (this.shown) {
        this.clear();
      }
    };

    clear = () => {
      if (!this.shown) return;
      this.shown = null;
      this.view.dispatch({ effects: setLinkRange.of(null) });
    };

    refresh(modDown: boolean) {
      const next = modDown && this.coords ? this.targetSpan(this.coords) : null;
      if (next?.from === this.shown?.from && next?.to === this.shown?.to) return;
      this.shown = next;
      this.view.dispatch({ effects: setLinkRange.of(next) });
    }

    targetSpan(coords: { x: number; y: number }): Span | null {
      const pos = this.view.posAtCoords(coords);
      if (pos == null) return null;
      return resolveDefinition(this.view.state, pos)?.span ?? null;
    }

    track(event: MouseEvent) {
      this.coords = { x: event.clientX, y: event.clientY };
      this.refresh(event.ctrlKey || event.metaKey);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.clear();
    }

    destroy() {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.clear);
    }
  },
  {
    eventHandlers: {
      mousemove(event) {
        this.track(event as MouseEvent);
      },
      mouseleave() {
        this.clear();
      },
      mousedown(event, view) {
        const mouse = event as MouseEvent;
        if (!(mouse.ctrlKey || mouse.metaKey) || mouse.button !== 0) return false;
        const pos = view.posAtCoords({ x: mouse.clientX, y: mouse.clientY });
        if (pos == null) return false;
        const target = resolveDefinition(view.state, pos);
        if (!target) return false;
        mouse.preventDefault();
        this.clear();
        jumpTo(view, target.pos);
        return true;
      },
    },
  },
);

export const dbmlNavigation: Extension[] = [navField, linkField, ctrlLinkPlugin];
