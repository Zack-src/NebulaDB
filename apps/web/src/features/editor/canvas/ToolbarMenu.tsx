import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONTEXT_MENU_CLASS } from "@/components/ui/contextMenuStyles";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";

const DEFAULT_MENU_WIDTH = 180;
const VIEWPORT_MARGIN = 8;
/** Gap between the menu and the trigger it hangs off. */
const TRIGGER_GAP = 8;
/** A menu shorter than this is not worth flipping for — it scrolls instead. */
const MIN_MENU_HEIGHT = 140;

export interface ToolbarMenuProps {
  /** Classes for the trigger button itself — it must be a real box, since the menu is anchored off its rect. */
  triggerClassName: (open: boolean) => string;
  triggerContent: ReactNode;
  tooltip: string;
  minWidth?: number;
  children: (close: () => void) => ReactNode;
}

/**
 * Popover behaviour shared by every dropdown in the floating canvas toolbar
 * (detail level, zoom, plugins). The menu is portalled to `document.body` and
 * anchored *above* its trigger, since the toolbar sits at the bottom of the
 * canvas.
 */
export function ToolbarMenu({ triggerClassName, triggerContent, tooltip, minWidth, children }: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const width = minWidth ?? DEFAULT_MENU_WIDTH;

  // Popover behaviour, not `useOutsideClick`: React Flow's pane stops
  // mousedown propagation for its own pan/drag handling, so a mousedown
  // listener never sees clicks on the canvas itself — `useDismissablePopover`
  // already accounts for this (listens for "click").
  useDismissablePopover(open, () => setOpen(false), [menuRef, triggerRef]);

  /**
   * Measured after mount rather than guessed at click time. Anchoring purely
   * from the bottom edge, as this did before, meant a long menu (the plugin
   * list, say) simply grew off the top of the window with its first entries
   * unreachable — there was no clamp and no max-height anywhere.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.scrollHeight;
    const above = rect.top - TRIGGER_GAP - VIEWPORT_MARGIN;
    const below = window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    // Toolbars sit at the bottom of the canvas, so above is the natural side —
    // flip only when it genuinely cannot fit and below is roomier.
    const openDown = menuHeight > above && below > above;
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN));

    setMenuStyle({
      left,
      minWidth: width,
      maxHeight: Math.max(MIN_MENU_HEIGHT, openDown ? below : above),
      overflowY: "auto",
      ...(openDown ? { top: rect.bottom + TRIGGER_GAP } : { bottom: window.innerHeight - rect.top + TRIGGER_GAP }),
    });
  }, [open, width]);

  const toggleOpen = () => {
    if (open) setMenuStyle(null);
    setOpen((current) => !current);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName(open)}
        onClick={(event) => {
          event.stopPropagation();
          toggleOpen();
        }}
        data-tooltip={tooltip}
        data-tooltip-pos="bottom"
      >
        {triggerContent}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            // `overflow-hidden` from the shared class would clip the entries a
            // scrolling menu is meant to reveal, so it is dropped here and the
            // measured `maxHeight` scrolls instead.
            className={`${CONTEXT_MENU_CLASS} overflow-y-auto`}
            style={menuStyle ?? { left: -9999, top: 0, minWidth: width, visibility: "hidden" }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
