/** Shared Tailwind classes for the table node (header/rows/badges) and its popovers (column properties / table settings). */

import { INPUT_XS_CLASS, LABEL_XS_CLASS } from "@/components/ui/inputStyles";

export const ROW_CLASS =
  "group relative flex h-[calc(27px_*_var(--canvas-font-scale))] cursor-pointer items-center gap-[7px] " +
  "whitespace-nowrap border-t border-border px-2.5 transition-colors duration-100 hover:bg-surface-hover";
/** isLinked (important, overrides isSelected) > isSelected > neither. */
export function rowStateClass(isLinked: boolean, isSelected: boolean): string {
  if (isLinked) return "bg-[rgba(99,102,241,0.15)] border-l-[2.5px] border-l-[#6366f1]";
  if (isSelected) return "bg-[rgba(99,102,241,0.15)] border-l-2 border-l-primary";
  return "";
}
export function rowNameClass(isLinked: boolean): string {
  return isLinked
    ? "overflow-hidden text-ellipsis font-semibold text-[#a5b4fc]"
    : "overflow-hidden text-ellipsis font-medium text-text";
}
export const ROW_TYPE_CLASS =
  "ml-1 shrink-0 whitespace-nowrap rounded-full border border-border bg-bg px-1.5 py-px font-mono " +
  "text-[calc(10.5px_*_var(--canvas-font-scale))] text-text-muted";

export const ROW_BADGES_CLASS = "ml-0.5 flex items-center gap-[3px]";
export const KW_BADGE_CLASS = "flex h-4 w-4 shrink-0 items-center justify-center leading-none";
export const KW_BADGE_COLOR: Record<"unique" | "notNull" | "increment" | "note", string> = {
  unique: "text-primary-hover",
  notNull: "text-[#38bdf8]",
  increment: "text-success",
  note: "cursor-help text-text-secondary",
};

export const ROW_ACTIONS_CLASS =
  "ml-auto flex items-center gap-[3px] opacity-0 transition-opacity duration-100 " +
  "group-hover:opacity-100 has-[.has-comments]:opacity-100 has-[.has-open-popover]:opacity-100";
export const ROW_ACTION_BTN_CLASS =
  "flex h-[18px] shrink-0 items-center justify-center rounded-sm px-[3px] text-text-muted transition-colors duration-100 " +
  "hover:bg-surface-hover hover:text-text [&.has-comments]:bg-surface-hover [&.has-comments]:text-text " +
  "[&.has-open-popover]:bg-surface-hover [&.has-open-popover]:text-text";

export const TABLE_NODE_CLASS =
  "min-w-[190px] overflow-hidden rounded-sm [transition:box-shadow_0.12s_ease,outline-color_0.12s_ease] " +
  "border border-border bg-surface text-[calc(12.5px_*_var(--canvas-font-scale))] shadow-sm";
/**
 * Selection is a real `outline`, not a box-shadow ring: an outline is drawn
 * outside the border box without taking part in layout, so it can't be clipped
 * by the node's own `overflow-hidden`, and the offset leaves a visible gap
 * between the table's border and the marker — the way Figma shows a selected
 * frame. It also survives the node's own shadow instead of fighting it for the
 * same `box-shadow` property.
 */
export const TABLE_NODE_SELECTED_CLASS = "shadow-md outline outline-2 outline-offset-2 outline-primary";

export const TABLE_HEADER_CLASS =
  "relative flex h-[calc(34px_*_var(--canvas-font-scale))] items-center gap-1.5 px-2 pl-2.5 " +
  "text-[calc(13px_*_var(--canvas-font-scale))] font-semibold text-white";
export const TABLE_NAME_CLASS = "overflow-hidden text-ellipsis whitespace-nowrap tracking-[-0.01em]";
/** Inline rename, sitting on the table's coloured header — glassy fill + white ring rather than a
 *  light box punched into the header, so it reads as the same surface being edited. */
export const TABLE_NAME_INPUT_CLASS =
  "w-full rounded-md border border-white/25 bg-black/25 px-2 py-[3px] " +
  "text-[calc(13px_*_var(--canvas-font-scale))] font-semibold text-white caret-white " +
  "shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] backdrop-blur-[2px] placeholder:text-white/50 " +
  "transition-[border-color,box-shadow] duration-150 ease-out " +
  "focus:border-white/70 focus:outline-hidden focus:ring-[3px] focus:ring-white/20";

export const HEADER_ACTIONS_CLASS =
  "ml-auto flex items-center gap-[3px] opacity-0 transition-opacity duration-100 " +
  "group-hover:opacity-100 group-[.is-selected]:opacity-100 has-[.has-comments]:opacity-100 has-[.has-open-popover]:opacity-100";
export const HEADER_BTN_CLASS =
  "flex h-5 shrink-0 items-center justify-center rounded-sm px-1 text-white/70 transition-colors duration-100 " +
  "hover:bg-white/20 hover:text-white [&.has-comments]:bg-white/20 [&.has-comments]:text-white " +
  "[&.has-open-popover]:bg-white/20 [&.has-open-popover]:text-white";

export const TABLE_FOOTER_CLASS = "border-t border-border bg-black/[0.12] px-1.5 py-[3px]";
export const TABLE_ADD_BTN_CLASS =
  "flex w-full items-center gap-[5px] rounded-sm border border-dashed border-transparent px-2 py-[3px] " +
  "text-[calc(11px_*_var(--canvas-font-scale))] font-medium text-text-muted transition-colors duration-100 " +
  "hover:border-border hover:bg-surface-hover hover:text-text";

export const POPOVER_HEADER_CLASS = "flex items-center justify-between border-b border-border pb-2";
export const POPOVER_TITLE_CLASS = "text-[11px] font-bold uppercase tracking-[0.06em] text-text-secondary";
export const POPOVER_GROUP_CLASS = "flex flex-col gap-1.5";
export const POPOVER_LABEL_CLASS = `${LABEL_XS_CLASS} uppercase tracking-[0.04em]`;
/** Popover fields use the app-wide dense field style so the canvas matches the rest of the UI. */
export const POPOVER_INPUT_CLASS = `${INPUT_XS_CLASS} w-full`;
/** Same, but for a value that is code-ish (default expressions, types). */
export const POPOVER_INPUT_MONO_CLASS = `${INPUT_XS_CLASS} w-full font-mono`;

export const FIELD_TYPE_CHIP_CLASS =
  "cursor-pointer rounded-full border border-border bg-bg px-[7px] py-0.5 font-mono text-[10.5px] text-text-secondary " +
  "transition-all duration-100 hover:border-primary-border hover:text-text";
export const FIELD_TYPE_CHIP_ACTIVE_CLASS = "border-primary-border bg-primary-light font-semibold text-primary-hover";

export const KW_TOGGLE_BASE_CLASS =
  "flex items-center justify-center gap-[5px] rounded-sm border border-border bg-bg px-2 py-[5px] text-[11px] " +
  "font-medium text-text-secondary transition-all duration-100 hover:bg-surface-hover hover:text-text";
export const KW_TOGGLE_ACTIVE_CLASS: Record<"pk" | "unique" | "notNull" | "increment", string> = {
  pk: "font-semibold text-warning bg-[rgba(251,191,36,0.16)] border-[rgba(251,191,36,0.45)]",
  unique: "font-semibold text-primary-hover bg-primary-light border-primary-border",
  notNull: "font-semibold text-[#38bdf8] bg-[rgba(56,189,248,0.16)] border-[rgba(56,189,248,0.45)]",
  increment: "font-semibold text-success bg-[rgba(52,211,153,0.16)] border-[rgba(52,211,153,0.45)]",
};
