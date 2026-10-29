import { getSearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Past this many matches the ruler stops: one mark per line is already a solid bar. */
const MAX_COUNTED_MATCHES = 5000;

/**
 * A mark on the scrollbar for each line holding a match of the open search, like VS Code's overview ruler. The
 * mark of the match the selection sits on is drawn apart.
 */
const searchScrollMarkers = ViewPlugin.fromClass(
  class {
    private readonly ruler = document.createElement("div");

    constructor(private readonly view: EditorView) {
      this.ruler.className = "cm-search-ruler";
      this.ruler.setAttribute("aria-hidden", "true");
      view.dom.appendChild(this.ruler);
      this.draw();
    }

    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)));
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.selectionSet ||
        queryChanged ||
        searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
      ) {
        this.draw();
      }
    }

    private draw() {
      const { state } = this.view;
      this.ruler.replaceChildren();
      if (!searchPanelOpen(state)) return;
      const query = getSearchQuery(state);
      if (!query.search || !query.valid) return;

      const height = this.view.contentHeight;
      if (height <= 0) return;
      const selection = state.selection.main;
      const drawn = new Map<number, HTMLElement>();
      const cursor = query.getCursor(state);
      let count = 0;
      for (let next = cursor.next(); !next.done && count < MAX_COUNTED_MATCHES; next = cursor.next(), count += 1) {
        const { from, to } = next.value;
        const top = this.view.lineBlockAt(from).top;
        let mark = drawn.get(top);
        if (!mark) {
          mark = document.createElement("div");
          mark.className = "cm-search-ruler-mark";
          mark.style.top = `${(top / height) * 100}%`;
          drawn.set(top, mark);
          this.ruler.appendChild(mark);
        }
        if (from === selection.from && to === selection.to) mark.classList.add("is-current");
      }
    }

    destroy() {
      this.ruler.remove();
    }
  },
);

const searchScrollMarkersTheme = EditorView.theme({
  ".cm-search-ruler": {
    position: "absolute",
    top: "0",
    bottom: "0",
    right: "0",
    width: "10px",
    pointerEvents: "none",
    zIndex: "5",
  },
  ".cm-search-ruler-mark": {
    position: "absolute",
    left: "2px",
    right: "2px",
    height: "3px",
    minHeight: "3px",
    borderRadius: "1px",
    backgroundColor: "rgba(234, 179, 8, 0.85)",
  },
  ".cm-search-ruler-mark.is-current": { backgroundColor: "#6366F1", zIndex: "1" },
});

/** The overview marks of the search matches, beside the scrollbar. */
export const searchScrollMarkersExtension = [searchScrollMarkers, searchScrollMarkersTheme];
