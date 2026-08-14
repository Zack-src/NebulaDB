/**
 * True when a keystroke landed somewhere the user is typing — a field, a
 * textarea, a contenteditable region, the CodeMirror pane, or anything opted
 * out with `.nokey`.
 *
 * Canvas-wide shortcuts (Delete, Ctrl+Z, Ctrl+D…) all have to check this, and
 * they each carried their own slightly different copy of the list.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable ||
    Boolean(element.closest(".cm-editor, .nokey, [contenteditable='true']"))
  );
}
