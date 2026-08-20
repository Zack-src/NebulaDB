import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Drop-in replacement for React Flow's `<EdgeLabelRenderer>`.
 *
 * Theirs resolves the label container with a *zustand selector* —
 * `state.domNode?.querySelector(".react-flow__edgelabel-renderer")` — so every
 * mounted edge label re-runs a DOM query on every single store mutation. With
 * a few hundred relations on screen that is a few hundred `querySelector`
 * calls per pan tick, per selection change, per drag frame: measured at ~70ms
 * of pure `querySelector` inside one table's colour change on a 500-table
 * schema, and the largest remaining cost with link highlighting on.
 *
 * The container is created once by React Flow and lives as long as the
 * canvas, so it is resolved once here and reused. `isConnected` covers the
 * only case where it can change — the canvas unmounting and remounting (view
 * switch, project close) — and the subscription exists purely to re-check
 * after the commit in which the container itself is first inserted, since the
 * first edge renders before that DOM node exists.
 */
let container: Element | null = null;
const listeners = new Set<() => void>();

function resolveContainer(): Element | null {
  if (container?.isConnected) return container;
  container = document.querySelector(".react-flow__edgelabel-renderer");
  return container;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!container?.isConnected) {
    // The container lands in the same commit as the edges themselves; a
    // microtask after subscription is the first moment it can be found.
    queueMicrotask(() => {
      if (resolveContainer()) for (const notify of listeners) notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function EdgeLabelPortal({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(subscribe, resolveContainer, () => null);
  if (!target) return null;
  return createPortal(children, target);
}
