import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONTEXT_MENU_CLASS } from "@/components/ui/contextMenuStyles";
import { useEscapeKey } from "@/hooks/useEscapeKey";

const DEFAULT_MENU_WIDTH = 180;
const VIEWPORT_MARGIN = 8;

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
  const [menuPosition, setMenuPosition] = useState<{ x: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const width = minWidth ?? DEFAULT_MENU_WIDTH;

  useEscapeKey(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    // "click", not "mousedown" (so this can't use `useOutsideClick`): React
    // Flow's pane stops mousedown propagation for its own pan/drag handling,
    // so a mousedown listener never sees clicks on the canvas itself.
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [open]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        x: Math.min(Math.max(VIEWPORT_MARGIN, rect.left), window.innerWidth - width - VIEWPORT_MARGIN),
        bottom: window.innerHeight - rect.top + VIEWPORT_MARGIN,
      });
    }
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
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className={CONTEXT_MENU_CLASS}
            style={{ left: menuPosition.x, bottom: menuPosition.bottom, minWidth: width }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
