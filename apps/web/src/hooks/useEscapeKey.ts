import { useEffect, useRef } from "react";

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
 * Runs `onEscape` while `active`, and only for the innermost active layer.
 *
 * Thirteen components each registered their own `keydown` listener for this
 * before; the part they could not get right individually is that closing
 * exactly one layer needs coordination between them.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  // The callback is read through a ref so the layer's position in the stack is
  // decided by mount order alone. Re-registering whenever `onEscape` changed
  // identity — which it does on most renders, being an inline arrow — would
  // silently promote an outer layer above an inner one.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const layer: EscapeLayer = { onEscape: () => onEscapeRef.current() };
    push(layer);
    return () => remove(layer);
  }, [active]);
}
