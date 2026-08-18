import { Compartment, EditorState, Facet, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import {
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  defaultKeymap,
  history,
  historyKeymap,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  selectMatchingBracket,
  toggleBlockComment,
  toggleComment,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  foldAll,
  unfoldAll,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { lintGutter, lintKeymap, nextDiagnostic, openLintPanel } from "@codemirror/lint";
import { athanorEditorTheme, dbmlLanguageSupport } from "@/features/editor/dbml/language";
import { createSearchPanel, openReplacePanel, searchPanelTheme } from "@/features/editor/dbml/searchPanel";
import { dbmlCompletion } from "@/features/editor/dbml/completion";
import { dbmlSymbolsField } from "@/features/editor/dbml/symbols";
import { dbmlNavigation, goToDefinition, navigateBack, navigateForward } from "@/features/editor/dbml/navigation";
import { canvasNavigateHandler, dbmlCanvasLink } from "@/features/editor/dbml/canvasLink";
import { dbmlHover } from "@/features/editor/dbml/hover";
import { dbmlLint } from "@/features/editor/dbml/lint";
import { formatDocument } from "@/features/editor/dbml/format";
import { renameHandler, startRename } from "@/features/editor/dbml/rename";
import {
  addCursorAbove,
  addCursorBelow,
  duplicateSelection,
  selectLineDown,
  smartTab,
  sortTableColumns,
  splitSelectionIntoLines,
  toLowerCaseSelection,
  toUpperCaseSelection,
} from "@/features/editor/dbml/commands";

/** Ctrl+S — ask the panel to push the document to the backend right away. */
export const saveHandler = Facet.define<() => void>();
/** Ctrl+P / Ctrl+Shift+O / Ctrl+Shift+P — open the panel's command palette. */
export const paletteHandler = Facet.define<(mode: "symbols" | "commands") => void>();

export const wrapCompartment = new Compartment();
export const fontCompartment = new Compartment();

function callFacet<T extends (...args: never[]) => void>(
  view: EditorView,
  facet: Facet<T, readonly T[]>,
  ...args: Parameters<T>
) {
  const handler = view.state.facet(facet)[0];
  if (!handler) return false;
  handler(...(args as never[]));
  return true;
}

export const dbmlKeymap = keymap.of([
  smartTab,
  // multi-cursor
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
  { key: "Mod-Alt-ArrowUp", run: addCursorAbove, preventDefault: true },
  { key: "Mod-Alt-ArrowDown", run: addCursorBelow, preventDefault: true },
  { key: "Shift-Alt-i", run: splitSelectionIntoLines, preventDefault: true },
  // line editing
  { key: "Mod-l", run: selectLineDown, preventDefault: true },
  { key: "Mod-Shift-d", run: duplicateSelection, preventDefault: true },
  { key: "Alt-ArrowUp", run: moveLineUp, preventDefault: true },
  { key: "Alt-ArrowDown", run: moveLineDown, preventDefault: true },
  { key: "Shift-Alt-ArrowUp", run: copyLineUp, preventDefault: true },
  { key: "Shift-Alt-ArrowDown", run: copyLineDown, preventDefault: true },
  { key: "Mod-Enter", run: insertBlankLine, preventDefault: true },
  { key: "Mod-/", run: toggleComment, preventDefault: true },
  { key: "Mod-Shift-a", run: toggleBlockComment, preventDefault: true },
  // navigation
  { key: "F12", run: goToDefinition, preventDefault: true },
  { key: "Mod-F12", run: goToDefinition, preventDefault: true },
  { key: "Alt-ArrowLeft", run: navigateBack, preventDefault: true },
  { key: "Alt-ArrowRight", run: navigateForward, preventDefault: true },
  { key: "Mod-g", run: gotoLine, preventDefault: true },
  { key: "Mod-Shift-\\", run: cursorMatchingBracket, shift: selectMatchingBracket, preventDefault: true },
  { key: "F8", run: nextDiagnostic, preventDefault: true },
  { key: "Mod-Shift-m", run: openLintPanel, preventDefault: true },
  // refactoring
  { key: "F2", run: startRename, preventDefault: true },
  { key: "Shift-Alt-f", run: formatDocument, preventDefault: true },
  { key: "Mod-Alt-o", run: sortTableColumns, preventDefault: true },
  // VS Code's own bindings for the same transforms, kept for muscle memory.
  { key: "Mod-k Mod-u", run: toUpperCaseSelection, preventDefault: true },
  { key: "Mod-k Mod-l", run: toLowerCaseSelection, preventDefault: true },
  // folding
  { key: "Mod-k Mod-0", run: foldAll, preventDefault: true },
  { key: "Mod-k Mod-j", run: unfoldAll, preventDefault: true },
  // completion / search / palette / save
  { key: "Mod-i", run: startCompletion, preventDefault: true },
  { key: "Mod-f", run: openSearchPanel, preventDefault: true },
  { key: "Mod-h", run: openReplacePanel, preventDefault: true },
  { key: "Mod-p", preventDefault: true, run: (view) => callFacet(view, paletteHandler, "symbols") },
  { key: "Mod-Shift-o", preventDefault: true, run: (view) => callFacet(view, paletteHandler, "symbols") },
  { key: "Mod-Shift-p", preventDefault: true, run: (view) => callFacet(view, paletteHandler, "commands") },
  { key: "Mod-s", preventDefault: true, run: (view) => callFacet(view, saveHandler) },
  { key: "Mod-z", run: undo, preventDefault: true },
  { key: "Mod-y", run: redo, preventDefault: true },
  { key: "Mod-Shift-z", run: redo, preventDefault: true },
]);

export interface DbmlEditorOptions {
  lineWrap: boolean;
  fontSize: number;
  onChange: (value: string) => void;
  onSave: () => void;
  onPalette: (mode: "symbols" | "commands") => void;
  onRename: (request: import("./rename.js").RenameRequest) => void;
  onNavigateToCanvas: (target: import("./canvasLink.js").CanvasNavigateTarget) => void;
}

export function fontTheme(size: number) {
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
    ".cm-gutters": { fontSize: `${Math.max(10, size - 1)}px` },
  });
}

export function createDbmlExtensions(options: DbmlEditorOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    scrollPastEnd(),
    EditorState.allowMultipleSelections.of(true),
    history(),
    codeFolding({ placeholderText: "⋯" }),
    foldGutter({ openText: "▾", closedText: "▸" }),
    lintGutter(),
    indentOnInput(),
    indentUnit.of("  "),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    search({ top: true, createPanel: createSearchPanel }),
    searchPanelTheme,
    dbmlSymbolsField,
    dbmlLanguageSupport,
    dbmlNavigation,
    dbmlCanvasLink,
    dbmlHover,
    dbmlLint,
    autocompletion({
      override: [dbmlCompletion],
      selectOnOpen: true,
      activateOnTyping: true,
      closeOnBlur: true,
      icons: true,
      maxRenderedOptions: 60,
    }),
    Prec.high(dbmlKeymap),
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...foldKeymap,
      ...lintKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    saveHandler.of(options.onSave),
    paletteHandler.of(options.onPalette),
    renameHandler.of(options.onRename),
    canvasNavigateHandler.of(options.onNavigateToCanvas),
    athanorEditorTheme,
    wrapCompartment.of(options.lineWrap ? EditorView.lineWrapping : []),
    fontCompartment.of(fontTheme(options.fontSize)),
    // Keep editor shortcuts from leaking into the canvas-level handlers.
    EditorView.domEventHandlers({
      keydown: (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) event.stopPropagation();
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
    }),
  ];
}
