import { useStore, ViewportPortal } from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness.js";
import { useAwarenessStates } from "@/features/collaboration/useAwarenessStates";

const selectZoom = (state: { transform: [number, number, number] }) => state.transform[2];

/**
 * Renders every other participant's live cursor directly into React Flow's
 * viewport-portal layer, instead of as an entry in the `nodes` array.
 *
 * Cursors used to be plain React Flow nodes so they'd inherit pan/zoom "for
 * free". That looked free, but wasn't: a remote peer's mouse move fires tens
 * of times a second, and every one of them pushed a brand-new `nodes` array
 * through React Flow's node reconciliation — which diffs *every* node on the
 * canvas, not just the cursor. On a schema with a few hundred tables that
 * per-frame walk was expensive enough to drop frames, which is exactly the
 * choppiness this component exists to fix.
 *
 * `ViewportPortal` renders into `.react-flow__viewport-portal`, the same
 * element React Flow keeps pinned to the current pan/zoom via a direct DOM
 * write in `useIsomorphicLayoutEffect` (deliberately kept outside React so
 * panning never re-renders anything). Cursors placed there inherit that same
 * free pan/zoom, but a cursor moving only ever re-renders this one small
 * subtree — never the tables, edges, or anything else on the canvas.
 *
 * Mounted once, isolated from the rest of the tree: `awareness` is read here
 * rather than threaded down as an already-derived prop, so a cursor moving
 * doesn't also re-render `ProjectEditor`/`CanvasArea` on its way here.
 */
export function RemoteCursorsLayer({ awareness }: { awareness: Awareness | null }) {
  const remoteAwareness = useAwarenessStates(awareness);
  /**
   * `ViewportPortal`'s subtree is scaled by React Flow's pan/zoom transform,
   * so a cursor drawn at a fixed pixel size would shrink/grow with the
   * canvas zoom — a remote pointer would look like a different size cursor
   * than the local OS one depending on how zoomed in the viewer happens to
   * be. Figma keeps remote cursors at a constant screen size regardless of
   * zoom; the counter-scale below (`1 / zoom`) on an inner wrapper does the
   * same, while the outer `translate` (left untouched) still needs to stay
   * in world coordinates so the cursor tip lands on the right canvas point.
   */
  const zoom = useStore(selectZoom);
  const counterScale = 1 / zoom;

  return (
    <ViewportPortal>
      {Array.from(remoteAwareness.entries()).map(([clientId, state]) => {
        if (!state.cursor) return null;
        return (
          <div
            key={clientId}
            style={{
              position: "absolute",
              transform: `translate(${state.cursor.x}px, ${state.cursor.y}px)`,
              transition: "transform 100ms linear",
              pointerEvents: "none",
              zIndex: 1000,
            }}
          >
            <div style={{ transform: `scale(${counterScale})`, transformOrigin: "top left" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: "absolute", top: -1, left: -1 }}>
                <path
                  d="M1 1 L1 14.5 L5 11 L7.8 16.5 L10 15.4 L7.2 10 L13 10 Z"
                  fill={state.user.color}
                  stroke="white"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="absolute left-[15px] top-[15px] whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
                style={{ background: state.user.color }}
              >
                {state.user.name}
              </span>
            </div>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
