/**
 * Moves an element to `document.body` (or another target) for as long as it is
 * mounted — the `createPortal(…, document.body)` of this codebase.
 *
 * Every popover that lives inside a canvas node needs this: nodes clip overflow
 * and get CSS-transformed for pan/zoom, so an absolutely-positioned child would
 * either be clipped or scaled/misplaced with the canvas. The element keeps its
 * component-tree ownership (reactivity, context, cleanup); only its DOM parent
 * changes.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
  const mount = (next: HTMLElement | string) => {
    const parent = typeof next === "string" ? document.querySelector(next) : next;
    parent?.appendChild(node);
  };
  mount(target);
  return {
    update(next: HTMLElement | string) {
      mount(next);
    },
    destroy() {
      node.remove();
    },
  };
}
