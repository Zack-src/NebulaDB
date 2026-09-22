import type { CanvasNode } from "@/types";

/** True when the keystroke landed in a text field — a global shortcut must not steal it. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    Boolean(element.closest(".cm-editor, .nokey, [contenteditable='true']"))
  );
}

/**
 * Find-a-table-by-name (Ctrl/Cmd+F).
 *
 * Matches are computed from the node list at query time only — never
 * re-derived from it — so a remote collaborator's edit elsewhere on the canvas
 * can't yank the viewport back to the active match mid-search.
 *
 * Must be called during component initialisation (it binds the shortcut).
 */
export function useCanvasSearch(nodes: () => CanvasNode[], jumpToTable: (tableId: string) => void) {
  let open = $state(false);
  let query = $state("");
  let matchIds = $state.raw<string[]>([]);
  let activeIndex = $state(0);

  function changeQuery(nextQuery: string) {
    query = nextQuery;
    const needle = nextQuery.trim().toLowerCase();
    const matches = needle
      ? nodes()
          .filter((node) => node.type === "table" && node.data.table.name.toLowerCase().includes(needle))
          .map((node) => node.id)
      : [];
    matchIds = matches;
    activeIndex = 0;
    if (matches.length > 0) jumpToTable(matches[0]);
  }

  function step(delta: 1 | -1) {
    if (matchIds.length === 0) return;
    const next = (activeIndex + delta + matchIds.length) % matchIds.length;
    activeIndex = next;
    jumpToTable(matchIds[next]);
  }

  function close() {
    open = false;
    query = "";
    matchIds = [];
    activeIndex = 0;
  }

  $effect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !isTypingTarget(event.target)) {
        event.preventDefault();
        open = true;
      } else if (event.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return {
    get open() {
      return open;
    },
    setOpen: (next: boolean) => {
      open = next;
    },
    get query() {
      return query;
    },
    get matchIds() {
      return matchIds;
    },
    get activeIndex() {
      return activeIndex;
    },
    changeQuery,
    step,
    close,
  };
}
