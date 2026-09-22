interface EscapeLayer {
  onEscape: () => void;
}

/**
 * Every active Escape layer, innermost last.
 *
 * A single shared stack, rather than one `window` listener per component,
 * because `stopPropagation` cannot do the job here: sibling listeners attached
 * to the *same* target all run regardless, so a popover inside a modal inside a
 * dialog closed all three at once. Only the top of the stack gets the key.
 */
const stack: EscapeLayer[] = [];
let listening = false;

function dispatch(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.stopPropagation();
  event.preventDefault();
  top.onEscape();
}

function push(layer: EscapeLayer) {
  stack.push(layer);
  if (!listening) {
    // Capture phase: the key is claimed before it can reach a focused control
    // that would handle it differently (CodeMirror, a native select).
    window.addEventListener("keydown", dispatch, true);
    listening = true;
  }
}

function remove(layer: EscapeLayer) {
  // By identity, not by popping: layers routinely unmount out of order (a
  // popover can outlive the row that opened it), and popping blindly would
  // hand Escape to the wrong component.
  const index = stack.indexOf(layer);
  if (index !== -1) stack.splice(index, 1);
  if (stack.length === 0 && listening) {
    window.removeEventListener("keydown", dispatch, true);
    listening = false;
  }
}

/**
 * Runs `onEscape` while `active()` is true, and only for the innermost active
 * layer. Must be called during component initialisation.
 *
 * `onEscape` is called through the closure at keydown time, so a layer's
 * position in the stack is decided by activation order alone — re-registering
 * whenever the callback changed would silently promote an outer layer above an
 * inner one.
 */
export function useEscapeKey(active: () => boolean, onEscape: () => void): void {
  $effect(() => {
    if (!active()) return;
    const layer: EscapeLayer = { onEscape: () => onEscape() };
    push(layer);
    return () => remove(layer);
  });
}
