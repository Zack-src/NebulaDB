import type { Command, Panel, ViewUpdate } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";

const ICON = {
  chevronRight: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  chevronDown: '<path d="M3.5 6 8 10.5 12.5 6"/>',
  up: '<path d="M8 12.5V4M4 7.5 8 3.5l4 4"/>',
  down: '<path d="M8 3.5V12M4 8.5l4 4 4-4"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  selectAll: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  replace: '<path d="M3 5.5h6a3 3 0 0 1 0 6H6"/><path d="M8 3.5 6 5.5l2 2"/>',
};

function svg(path: string, className = ""): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 16 16");
  node.setAttribute("width", "14");
  node.setAttribute("height", "14");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.5");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.innerHTML = path;
  if (className) node.setAttribute("class", className);
  return node;
}

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-as-btn";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.append(svg(icon));
  button.onclick = (event) => {
    event.preventDefault();
    onClick();
  };
  return button;
}

function toggleButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-as-toggle";
  button.title = title;
  button.textContent = label;
  button.onclick = (event) => {
    event.preventDefault();
    onClick();
  };
  return button;
}

const MAX_COUNTED_MATCHES = 5000;

/** `current/total` for the query, counted from the top of the document. */
function countMatches(view: EditorView, query: SearchQuery): { index: number; total: number } {
  if (!query.valid) return { index: 0, total: 0 };
  const cursor = query.getCursor(view.state);
  const selection = view.state.selection.main;
  let total = 0;
  let index = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    if (index === 0 && next.value.from >= selection.from) index = total;
    if (total >= MAX_COUNTED_MATCHES) break;
  }
  return { index, total };
}

/**
 * Replaces CodeMirror's default search form with a floating, VS Code-shaped
 * panel: match counter, icon toggles for case/word/regex, prev/next, select-all
 * and a collapsible replace row.
 */
/** The panel currently mounted, so Ctrl+H can expand an already-open panel. */
let activePanel: { expandReplace: () => void } | null = null;

/** Ctrl+H — open the panel with the replace row unfolded. */
export const openReplacePanel: Command = (view) => {
  if (!activePanel) openSearchPanel(view);
  // the panel is mounted during the view update, which may not have run yet
  if (activePanel) activePanel.expandReplace();
  else requestAnimationFrame(() => activePanel?.expandReplace());
  return true;
};

export function createSearchPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state);

  const dom = document.createElement("div");
  dom.className = "cm-athanor-search";
  dom.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.target === replaceInput) {
        if (event.ctrlKey || event.metaKey) replaceAll(view);
        else replaceNext(view);
      } else if (event.altKey) {
        selectMatches(view);
      } else if (event.shiftKey) {
        findPrevious(view);
      } else {
        findNext(view);
      }
    }
    event.stopPropagation();
  };

  let showReplace = Boolean(initial.replace);

  const expand = iconButton(ICON.chevronRight, "Toggle replace (Ctrl+H)", () => {
    showReplace = !showReplace;
    render();
    (showReplace ? replaceInput : searchInput).focus();
  });
  expand.classList.add("cm-as-expand");

  const searchInput = document.createElement("input");
  searchInput.className = "cm-as-input";
  searchInput.placeholder = "Find";
  searchInput.value = initial.search;
  searchInput.setAttribute("main-field", "true");
  searchInput.oninput = () => commit();

  const replaceInput = document.createElement("input");
  replaceInput.className = "cm-as-input";
  replaceInput.placeholder = "Replace";
  replaceInput.value = initial.replace;
  replaceInput.oninput = () => commit();

  const counter = document.createElement("span");
  counter.className = "cm-as-counter";

  const caseToggle = toggleButton("Aa", "Match case", () => {
    state.caseSensitive = !state.caseSensitive;
    commit();
  });
  const wordToggle = toggleButton("ab", "Match whole word", () => {
    state.wholeWord = !state.wholeWord;
    commit();
  });
  const regexpToggle = toggleButton(".*", "Use regular expression", () => {
    state.regexp = !state.regexp;
    commit();
  });

  const state = {
    caseSensitive: initial.caseSensitive,
    wholeWord: initial.wholeWord,
    regexp: initial.regexp,
  };

  const replaceButton = document.createElement("button");
  replaceButton.type = "button";
  replaceButton.className = "cm-as-text-btn";
  replaceButton.textContent = "Replace";
  replaceButton.onclick = (event) => {
    event.preventDefault();
    replaceNext(view);
  };

  const replaceAllButton = document.createElement("button");
  replaceAllButton.type = "button";
  replaceAllButton.className = "cm-as-text-btn";
  replaceAllButton.textContent = "All";
  replaceAllButton.title = "Replace all (Ctrl+Enter)";
  replaceAllButton.onclick = (event) => {
    event.preventDefault();
    replaceAll(view);
  };

  const searchRow = document.createElement("div");
  searchRow.className = "cm-as-row";
  const field = document.createElement("div");
  field.className = "cm-as-field";
  field.append(svg(ICON.search, "cm-as-field-icon"), searchInput, counter, caseToggle, wordToggle, regexpToggle);
  searchRow.append(
    field,
    iconButton(ICON.up, "Previous match (Shift+Enter)", () => findPrevious(view)),
    iconButton(ICON.down, "Next match (Enter)", () => findNext(view)),
    iconButton(ICON.selectAll, "Select all matches (Alt+Enter)", () => selectMatches(view)),
    iconButton(ICON.close, "Close (Escape)", () => {
      closeSearchPanel(view);
      view.focus();
    }),
  );

  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-as-row";
  const replaceField = document.createElement("div");
  replaceField.className = "cm-as-field";
  replaceField.append(svg(ICON.replace, "cm-as-field-icon"), replaceInput);
  replaceRow.append(replaceField, replaceButton, replaceAllButton);

  const body = document.createElement("div");
  body.className = "cm-as-body";
  body.append(searchRow, replaceRow);
  dom.append(expand, body);

  function commit() {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: searchInput.value,
          replace: replaceInput.value,
          caseSensitive: state.caseSensitive,
          wholeWord: state.wholeWord,
          regexp: state.regexp,
        }),
      ),
    });
  }

  function render() {
    expand.replaceChildren(svg(showReplace ? ICON.chevronDown : ICON.chevronRight));
    replaceRow.style.display = showReplace ? "flex" : "none";
    caseToggle.classList.toggle("is-active", state.caseSensitive);
    wordToggle.classList.toggle("is-active", state.wholeWord);
    regexpToggle.classList.toggle("is-active", state.regexp);

    const query = getSearchQuery(view.state);
    if (!searchInput.value) {
      counter.textContent = "";
      field.classList.remove("is-empty");
      return;
    }
    if (state.regexp && !query.valid) {
      counter.textContent = "invalid regexp";
      field.classList.add("is-empty");
      return;
    }
    const { index, total } = countMatches(view, query);
    counter.textContent =
      total === 0 ? "no results" : `${index || 1}/${total}${total >= MAX_COUNTED_MATCHES ? "+" : ""}`;
    field.classList.toggle("is-empty", total === 0);
  }

  return {
    dom,
    top: true,
    mount() {
      activePanel = {
        expandReplace: () => {
          showReplace = true;
          render();
          replaceInput.focus();
        },
      };
      render();
      searchInput.focus();
      searchInput.select();
    },
    destroy() {
      activePanel = null;
    },
    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            const query = effect.value;
            if (document.activeElement !== searchInput) searchInput.value = query.search;
            if (document.activeElement !== replaceInput) replaceInput.value = query.replace;
            state.caseSensitive = query.caseSensitive;
            state.wholeWord = query.wholeWord;
            state.regexp = query.regexp;
            if (query.replace) showReplace = true;
          }
        }
      }
      if (update.docChanged || update.selectionSet || update.transactions.length) render();
    },
  };
}

export const searchPanelTheme = EditorView.theme({
  // float the search panel over the content instead of pushing it down
  ".cm-panels.cm-panels-top:has(.cm-athanor-search)": {
    position: "absolute",
    top: "6px",
    right: "14px",
    left: "auto",
    zIndex: "20",
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-athanor-search": {
    display: "flex",
    alignItems: "flex-start",
    gap: "2px",
    padding: "6px",
    borderRadius: "8px",
    border: "1px solid #3F3F46",
    backgroundColor: "rgba(30, 32, 36, 0.96)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 12px 28px -8px rgba(0,0,0,0.65)",
    font: "12px/1.4 var(--font-sans, system-ui, sans-serif)",
  },
  ".cm-as-body": { display: "flex", flexDirection: "column", gap: "4px" },
  ".cm-as-row": { display: "flex", alignItems: "center", gap: "2px" },
  ".cm-as-field": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: "220px",
    padding: "0 4px 0 6px",
    borderRadius: "5px",
    border: "1px solid #3F3F46",
    backgroundColor: "#17181B",
    transition: "border-color 120ms ease",
  },
  ".cm-as-field:focus-within": { borderColor: "#6366F1" },
  ".cm-as-field.is-empty": { borderColor: "#EF4444" },
  ".cm-as-field-icon": { color: "#64748B", flexShrink: "0" },
  ".cm-as-input": {
    flex: "1",
    minWidth: "0",
    padding: "4px 2px",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#E2E8F0",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "12px",
  },
  ".cm-as-input::placeholder": { color: "#64748B" },
  ".cm-as-counter": { color: "#94A3B8", fontSize: "11px", whiteSpace: "nowrap", padding: "0 2px" },
  ".cm-as-btn, .cm-as-toggle, .cm-as-text-btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid transparent",
    borderRadius: "5px",
    background: "transparent",
    color: "#94A3B8",
    cursor: "pointer",
    transition: "background-color 100ms ease, color 100ms ease",
  },
  ".cm-as-btn": { width: "26px", height: "26px", padding: "0" },
  ".cm-as-toggle": {
    height: "20px",
    minWidth: "22px",
    padding: "0 4px",
    fontSize: "11px",
    fontWeight: "600",
    fontFamily: "var(--font-mono, monospace)",
  },
  ".cm-as-text-btn": { height: "26px", padding: "0 8px", fontSize: "11.5px" },
  ".cm-as-btn:hover, .cm-as-toggle:hover, .cm-as-text-btn:hover": { backgroundColor: "#27272A", color: "#E2E8F0" },
  ".cm-as-toggle.is-active": { backgroundColor: "rgba(99,102,241,0.22)", borderColor: "#6366F1", color: "#C7D2FE" },
  ".cm-as-expand": { width: "22px", height: "26px", padding: "0", color: "#64748B" },
  ".cm-as-expand:hover": { backgroundColor: "#27272A", color: "#E2E8F0" },
});
