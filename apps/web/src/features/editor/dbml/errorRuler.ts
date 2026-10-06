import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";

/**
 * A strip of red ticks over the editor's scrollbar track, one per line with an "error"
 * diagnostic (like VS Code's overview ruler), positioned as a fraction of the whole document.
 * Appended to `.cm-editor`, not `.cm-scroller`, so it doesn't scroll away.
 */
class ErrorRuler {
  dom: HTMLElement;
  private resizeObserver: ResizeObserver;

  constructor(private view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-error-ruler";
    view.dom.appendChild(this.dom);
    // The ruler maps line number -> vertical %, which only needs to shift on
    // an editor resize (a doc change already comes with its own update()).
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(view.dom);
    this.refresh();
  }

  update(update: ViewUpdate) {
    const diagnosticsChanged = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
    );
    if (update.docChanged || diagnosticsChanged) this.refresh();
  }

  private refresh() {
    const { state } = this.view;
    const totalLines = Math.max(1, state.doc.lines - 1);
    // A Set, not an array: several diagnostics can land on the same line
    // (e.g. a duplicate table name plus a bad column type on it) and should
    // only draw one tick.
    const lineRatios = new Set<number>();
    forEachDiagnostic(state, (diagnostic, from) => {
      if (diagnostic.severity !== "error") return;
      const lineNumber = state.doc.lineAt(from).number - 1;
      lineRatios.add(lineNumber / totalLines);
    });

    this.dom.replaceChildren(
      ...[...lineRatios].map((ratio) => {
        const mark = document.createElement("div");
        mark.className = "cm-error-ruler-mark";
        mark.style.top = `${ratio * 100}%`;
        return mark;
      }),
    );
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.dom.remove();
  }
}

export const errorRuler = [
  ViewPlugin.fromClass(ErrorRuler),
  EditorView.theme({
    ".cm-error-ruler": {
      position: "absolute",
      top: "0",
      bottom: "0",
      right: "0",
      width: "8px",
      pointerEvents: "none",
      zIndex: "5",
    },
    ".cm-error-ruler-mark": {
      position: "absolute",
      right: "0",
      width: "8px",
      height: "3px",
      marginTop: "-1.5px",
      borderRadius: "1px",
      backgroundColor: "#EF4444",
      boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
    },
  }),
];
