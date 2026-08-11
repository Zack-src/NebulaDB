import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipPos = "top" | "bottom" | "left";

interface TooltipState {
  text: string;
  /** Longer free text (a column/table note) shown under `text` — left-aligned, wider box, never truncated mid-word. */
  note: string | null;
  rect: DOMRect;
  pos: TooltipPos;
}

const SHOW_DELAY = 400;
/** A note is the reason the user is hovering, so don't make them wait the full delay for it. */
const NOTE_SHOW_DELAY = 150;
/** Viewport margin, and the top offset that keeps the box clear of the app header. */
const MARGIN = 8;
const TOP_LIMIT = 34;

/**
 * Single delegated tooltip for every `data-tooltip` element in the app.
 * Portaled to `document.body` and positioned with `position: fixed` from the
 * hovered element's own rect, so it never gets clipped by an ancestor's
 * `overflow: hidden`/`auto` (the header's horizontal scroll area, React
 * Flow's Controls panel, etc.) the way a CSS `::after` on the element itself
 * would be. Mount once near the app root.
 *
 * `data-tooltip-note` adds a second block under the label for free text
 * (column/table notes): wider, left-aligned, wrapped in full rather than
 * truncated. Because such a box can be tall, placement is measured after
 * render — it flips below the target and clamps to the viewport instead of
 * running off the top of the screen.
 */
export function GlobalTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const targetRef = useRef<Element | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };

    const hide = () => {
      clearTimer();
      targetRef.current = null;
      setState(null);
    };

    const show = (el: Element) => {
      const text = el.getAttribute("data-tooltip");
      if (!text) return;
      const pos = (el.getAttribute("data-tooltip-pos") as TooltipPos | null) ?? "top";
      setState({ text, note: el.getAttribute("data-tooltip-note") || null, rect: el.getBoundingClientRect(), pos });
    };

    const onOver = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.("[data-tooltip]");
      if (!el || el === targetRef.current) return;
      clearTimer();
      targetRef.current = el;
      const delay = el.hasAttribute("data-tooltip-note") ? NOTE_SHOW_DELAY : SHOW_DELAY;
      timerRef.current = window.setTimeout(() => show(el), delay);
    };

    const onOut = (event: Event) => {
      if (!targetRef.current) return;
      const related = (event as MouseEvent).relatedTarget as Node | null;
      if (related && targetRef.current.contains(related)) return;
      hide();
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", onOut, true);
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      clearTimer();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", onOut, true);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Placement is a DOM write (no extra render): the box renders hidden at 0,0,
  // gets measured, then moved into place and revealed.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !state) return;
    const { rect, pos } = state;
    const w = box.offsetWidth;
    const h = box.offsetHeight;

    let left: number;
    let top: number;
    if (pos === "left") {
      left = rect.left - MARGIN - w;
      top = rect.top + rect.height / 2 - h / 2;
    } else if (pos === "bottom") {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.bottom + MARGIN;
    } else {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top - MARGIN - h;
      // not enough room above (tall note boxes especially) -> flip below
      if (top < TOP_LIMIT) top = rect.bottom + MARGIN;
    }

    box.style.left = `${Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - w - MARGIN))}px`;
    box.style.top = `${Math.min(Math.max(TOP_LIMIT, top), Math.max(TOP_LIMIT, window.innerHeight - h - MARGIN))}px`;
    box.style.visibility = "visible";
  }, [state]);

  if (!state) return null;
  const { text, note, rect, pos } = state;

  return createPortal(
    <div
      // Remounting per target resets the hidden/0,0 starting point, so a new
      // tooltip can never flash at the previous one's coordinates.
      key={`${rect.top},${rect.left},${pos}`}
      ref={boxRef}
      className={`pointer-events-none fixed left-0 top-0 z-[3000] w-max whitespace-pre-line rounded-sm border border-border-strong bg-surface-raised font-sans text-[11px] font-medium leading-[1.35] text-text shadow-md ${
        note
          ? "max-h-[70vh] max-w-[340px] overflow-hidden rounded-md px-2.5 py-2 text-left"
          : "max-w-[240px] px-2 py-[5px] text-center"
      }`}
      style={{ visibility: "hidden" }}
    >
      {text}
      {note && (
        <>
          <span className="my-1.5 block h-px bg-border" />
          <span className="block break-words text-[11.5px] font-normal leading-[1.45] text-text-secondary">{note}</span>
        </>
      )}
    </div>,
    document.body,
  );
}
