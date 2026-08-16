import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CANVAS_TOOLBAR_CLASS } from "./canvasToolbarStyles";

/**
 * Last natural width measured per pill, keyed by `pillId` — module-level and
 * deliberately not React state: it has to survive the full unmount/remount
 * an MLD/MCD switch causes (a fresh component instance every time), and
 * it's purely an animation starting point, never read for layout decisions.
 */
const lastWidths = new Map<string, number>();

/** A bit past the CSS transition's own 200ms, so it always fires after any real animation has finished settling. */
const RELEASE_DELAY_MS = 260;

/**
 * The `CANVAS_TOOLBAR_CLASS` pill, but its width morphs from whatever it
 * measured last time to its new natural width instead of snapping straight
 * to it — an MLD/MCD switch swaps in a whole different toolbar (different
 * buttons, different count), not just one button toggling, so the pill can
 * visibly grow or shrink rather than jump-cutting to its new size.
 *
 * FLIP technique: render pinned to the previous width, measure this mount's
 * actual (natural) content width, then transition to it. The cache write
 * happens unconditionally in the layout effect rather than on
 * `transitionend` — waiting for that event would mean the very first mount
 * (nothing cached yet, so old width === new width, nothing to actually
 * transition) never seeds the cache, and every mount after it starts from
 * "nothing cached" too, forever. Releasing the fixed width back to `auto`
 * is on a timeout for the same reason: a `transitionend` that never fires
 * would otherwise leave the pill pinned to a stale width indefinitely,
 * which is what could clip a trailing button (e.g. Plugins) after a bad
 * measurement.
 */
export function AnimatedToolbarPill({
  pillId,
  className = "",
  children,
}: {
  pillId: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(() => lastWidths.get(pillId));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = el.scrollWidth;
    lastWidths.set(pillId, target);

    const raf = requestAnimationFrame(() => setWidth(target));
    const release = setTimeout(() => setWidth(undefined), RELEASE_DELAY_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(release);
    };
  }, [pillId]);

  return (
    <div
      ref={ref}
      className={`${CANVAS_TOOLBAR_CLASS} overflow-hidden transition-[width] duration-200 ease-out ${className}`}
      style={width !== undefined ? { width } : undefined}
    >
      {children}
    </div>
  );
}
