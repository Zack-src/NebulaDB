import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { PlusIcon } from "@/components/icons/Icons";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useAnchoredPlacement } from "@/hooks/useMenuPlacement";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useTranslation } from "@/i18n/useTranslation";

export const SWATCH_CELL_CLASS =
  "h-[22px] w-[22px] shrink-0 rounded-sm border-[1.5px] border-white/15 p-0 cursor-pointer transition-transform duration-75 ease-out hover:scale-110";
export const SWATCH_CELL_ACTIVE_CLASS = "outline outline-2 outline-primary outline-offset-1";
export const SWATCH_GRID_CLASS = "grid grid-cols-5 gap-1.5 mb-2";

export const DEFAULT_PALETTE = [
  "#6366f1",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#14b8a6",
  "#475569",
  "#f97316",
  "#6b7280",
  "#ec4899",
  "#0ea5e9",
  "#84cc16",
  "#f43f5e",
  "#4f46e5",
  "#06b6d4",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Small circular swatch button that opens a preset-color popover (+ custom
 * hex) instead of the OS native color picker. Portaled to `document.body`
 * since every caller lives inside a React Flow node — nodes clip overflow
 * and get CSS-transformed for pan/zoom, so an absolutely-positioned child
 * popover would either be clipped or scaled/misplaced with the canvas.
 *
 * `palette` is per-project (persisted in the doc's meta map, shared by every
 * table/zone/note picker in that project) rather than a fixed global list —
 * callers fall back to `DEFAULT_PALETTE` when the project hasn't customized
 * one yet. Right-click a swatch to remove it; the "+" cell adds whatever the
 * current value is.
 */
export function ColorSwatchPicker(props: {
  value: string;
  onChange: (color: string) => void;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  triggerClassName: string;
  tooltip?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(props.value);
  const [lastValue, setLastValue] = useState(props.value);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Re-seed the draft when the committed color changes, adjusting state during
  // render rather than from an effect: React re-runs this component before
  // touching the DOM, so there is no flash of the stale value and no second
  // render pass (see "You Might Not Need an Effect" — adjusting state when a
  // prop changes).
  if (props.value !== lastValue) {
    setLastValue(props.value);
    setHexDraft(props.value);
  }

  useDismissablePopover(open, () => setOpen(false), [popoverRef, triggerRef]);

  const placement = useAnchoredPlacement(open ? triggerRect : null, popoverRef);

  const toggle = () => {
    if (!open && triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  const commitHex = () => {
    const next = hexDraft.trim();
    if (HEX_RE.test(next)) props.onChange(next);
    else setHexDraft(props.value);
  };

  const removeFromPalette = (event: ReactMouseEvent, color: string) => {
    event.preventDefault();
    props.onPaletteChange(props.palette.filter((c) => c !== color));
  };

  const addCurrentToPalette = () => {
    if (props.palette.some((c) => c.toLowerCase() === props.value.toLowerCase())) return;
    props.onPaletteChange([...props.palette, props.value]);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`nodrag ${props.triggerClassName}`}
        style={{ background: props.value }}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        data-tooltip={props.tooltip ?? "Color"}
      />
      {open &&
        triggerRect &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[var(--z-popover)] animate-modal-in rounded-md border border-border-strong bg-surface-raised p-2.5 shadow-lg nodrag"
            style={placement ?? { left: triggerRect.left, top: triggerRect.bottom + 6, visibility: "hidden" }}
          >
            <div className={SWATCH_GRID_CLASS}>
              {props.palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${SWATCH_CELL_CLASS} ${c.toLowerCase() === props.value.toLowerCase() ? SWATCH_CELL_ACTIVE_CLASS : ""}`}
                  style={{ background: c }}
                  onClick={() => {
                    props.onChange(c);
                    setOpen(false);
                  }}
                  onContextMenu={(event) => removeFromPalette(event, c)}
                  data-tooltip={`${c} (right-click to remove)`}
                />
              ))}
              <button
                type="button"
                className={`${SWATCH_CELL_CLASS} flex items-center justify-center border-dashed bg-surface text-text-muted hover:border-text-muted hover:text-text`}
                onClick={addCurrentToPalette}
                data-tooltip={t("palette.addColor")}
              >
                <PlusIcon size={11} />
              </button>
            </div>
            <input
              className={`${INPUT_XS_CLASS} w-full font-mono`}
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitHex();
                if (event.key === "Escape") setHexDraft(props.value);
              }}
              spellCheck={false}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
