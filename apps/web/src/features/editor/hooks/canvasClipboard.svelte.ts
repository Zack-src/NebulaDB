import type { Position, Project } from "@athanordb/shared";
import { isTypingTarget } from "@/utils/dom";
import {
  copyTables,
  parseClipboard,
  serializeClipboard,
  type PasteTarget,
  type TableClipboard,
} from "@/features/editor/canvas/tableClipboard";

/**
 * The last thing copied in this tab. The context menu's "Paste" falls back on
 * it when the browser will not let a page *read* the clipboard — outside a
 * secure context (a self-hosted instance on plain http), or once the user has
 * declined the permission prompt. Ctrl+V never needs it: a `paste` event hands
 * the text over without any permission.
 */
let lastCopied: string | null = null;

/**
 * Ctrl/Cmd+C and Ctrl/Cmd+V for tables on the canvas, plus the two entry
 * points the context menu uses.
 *
 * Bound to the `copy` / `paste` DOM events rather than to keydown: they carry
 * the clipboard with them, so this works without the async Clipboard API (and
 * its permission prompt), and the browser's own Edit ▸ Copy / Paste menu
 * entries behave the same as the shortcut.
 */
export function useCanvasClipboard(options: {
  project: () => Project | null;
  selectedTableIds: () => string[];
  /** Copying is reading: allowed on a read-only project, but not from the MCD view, whose nodes are not the project's tables. */
  canCopy: () => boolean;
  canPaste: () => boolean;
  paste: (clipboard: TableClipboard, target: PasteTarget) => number;
  onCopied: (count: number) => void;
  onPasted: (count: number) => void;
  onNothingToPaste: () => void;
}) {
  /** How many times the current clipboard was pasted without a position — see `PasteTarget.repeat`. */
  let repeat = { text: "", count: 0 };

  function selectionAsText(): { text: string; count: number } | null {
    const project = options.project();
    if (!project || !options.canCopy()) return null;
    const clipboard = copyTables(project, options.selectedTableIds());
    return clipboard ? { text: serializeClipboard(clipboard), count: clipboard.tables.length } : null;
  }

  function pasteText(text: string, at?: Position): boolean {
    const clipboard = parseClipboard(text);
    if (!clipboard || !options.canPaste()) return false;
    if (repeat.text !== text) repeat = { text, count: 0 };
    const count = options.paste(clipboard, at ? { at } : { repeat: repeat.count++ });
    if (count > 0) options.onPasted(count);
    return true;
  }

  $effect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target) || !event.clipboardData) return;
      // Text highlighted somewhere on the page: that is what the user is copying.
      if (!window.getSelection()?.isCollapsed) return;
      const selection = selectionAsText();
      if (!selection) return;
      event.clipboardData.setData("text/plain", selection.text);
      event.preventDefault();
      lastCopied = selection.text;
      options.onCopied(selection.count);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (pasteText(event.clipboardData?.getData("text/plain") ?? "")) event.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  });

  return {
    /** Context menu ▸ Copy. */
    copy() {
      const selection = selectionAsText();
      if (!selection) return;
      lastCopied = selection.text;
      // Best effort: without it the copy still pastes within this tab.
      void navigator.clipboard?.writeText(selection.text).catch(() => {});
      options.onCopied(selection.count);
    },
    /** Context menu ▸ Paste, at the position that was right-clicked. */
    async pasteAt(position: Position) {
      let text: string | null = null;
      try {
        text = (await navigator.clipboard?.readText()) ?? null;
      } catch {
        // refused or unavailable — fall back on this tab's own last copy
      }
      if (text && pasteText(text, position)) return;
      if (lastCopied && pasteText(lastCopied, position)) return;
      options.onNothingToPaste();
    },
  };
}
