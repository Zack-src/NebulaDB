/** Shared Tailwind classes for the table node (header/rows/badges) and its popovers (column properties / table settings). */

import { INPUT_XS_CLASS, LABEL_XS_CLASS } from "@/components/ui/inputStyles";

/**
 * `nodrag`: React Flow's own node-selection gesture and its drag-the-node
 * gesture are the same pointerdown-driven system, gated by this one class —
 * without it, clicking a row to select *that column* also selected the whole
 * table underneath it (React Flow resolves selection at the start of the
 * gesture, before it can tell a click from a drag), which was why a link kept
 * glowing long after the column stopped being hovered: the table stayed
 * "selected" until something else was clicked. Dragging the table by grabbing
 * a row is lost as a side effect, which is the right trade — a row is already
 * busy with its own click-to-select and button interactions, and the header
 * remains a clear, unambiguous drag handle.
 */
export const ROW_CLASS =
  "group relative flex h-[calc(27px_*_var(--canvas-font-scale))] cursor-pointer items-center gap-[7px] " +
  "whitespace-nowrap border-t border-border px-2.5 transition-colors duration-100 hover:bg-surface-hover nodrag";
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
/** Inline column rename — same glassy-fill idea as `TABLE_NAME_INPUT_CLASS`, just sized to sit inline in a row instead of the header. */
export const ROW_NAME_INPUT_CLASS =
  "min-w-0 flex-1 rounded-sm border border-primary-border bg-bg px-1 py-px font-medium text-text caret-text " +
  "shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] focus:outline-hidden focus:ring-2 focus:ring-primary/30";

export const ROW_TYPE_CLASS =
  "ml-1 shrink-0 whitespace-nowrap rounded-full border border-border bg-bg px-1.5 py-px font-mono " +
  "text-[calc(10.5px_*_var(--canvas-font-scale))] text-text-muted";

/** Drag handle for column reordering — hidden until the row is hovered, same as the edit/comment buttons on the other end of the row. */
export const ROW_DRAG_HANDLE_CLASS =
  "flex h-5 w-3.5 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-muted opacity-0 " +
  "transition-opacity duration-100 hover:text-text group-hover:opacity-100 active:cursor-grabbing";
/** Drop-position indicator while another column is dragged over this row — an inset line so it doesn't shift row height/layout. */
export function rowDropIndicatorClass(side: "before" | "after" | null): string {
  if (side === "before") return "shadow-[inset_0_2px_0_0_var(--color-primary)]";
  if (side === "after") return "shadow-[inset_0_-2px_0_0_var(--color-primary)]";
  return "";
}

export const ROW_BADGES_CLASS = "ml-0.5 flex items-center gap-[3px]";
export const KW_BADGE_CLASS = "flex h-4 w-4 shrink-0 items-center justify-center leading-none";
export const KW_BADGE_COLOR: Record<"unique" | "notNull" | "increment" | "note", string> = {
  unique: "text-primary-hover",
  notNull: "text-info-hover",
  increment: "text-success-hover",
  note: "cursor-help text-text-secondary",
};

export const ROW_ACTIONS_CLASS =
  "ml-auto flex items-center gap-[3px] opacity-0 transition-opacity duration-100 " +
  "group-hover:opacity-100 has-[.has-comments]:opacity-100 has-[.has-open-popover]:opacity-100";
export const ROW_ACTION_BTN_CLASS =
  "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm px-1 text-text-muted transition-colors duration-100 " +
  "hover:bg-surface-hover hover:text-text [&.has-comments]:bg-surface-hover [&.has-comments]:text-text " +
  "[&.has-open-popover]:bg-surface-hover [&.has-open-popover]:text-text";

export const TABLE_NODE_CLASS =
  "min-w-[190px] overflow-hidden rounded-sm [transition:box-shadow_0.12s_ease,border-color_0.12s_ease] " +
  "border border-border bg-surface text-[calc(12.5px_*_var(--canvas-font-scale))] shadow-sm";
/**
 * Selection recolours the table's own 1px border to primary instead of adding
 * a second, thicker ring around it — an `outline` used to do that job, but at
 * `outline-2 outline-offset-2` it read as a chunky extra frame rather than
 * "this border is now selected". The border colour is set inline (`TableNode`)
 * rather than as a class here, so it composes with a user-chosen custom border
 * colour: selected wins while selected, the custom colour is what's underneath
 * once it isn't.
 */
export const TABLE_NODE_SELECTED_CLASS = "shadow-md";

/** Foreground is set per node from the actual header colour — a user who picks pale yellow gets dark text, not invisible white. */
export const TABLE_HEADER_CLASS =
  "relative flex h-[calc(34px_*_var(--canvas-font-scale))] items-center gap-1.5 px-2 pl-2.5 " +
  "text-[calc(13px_*_var(--canvas-font-scale))] font-semibold";
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
/** Inherits the header's computed colour rather than pinning white, for the same reason. */
export const HEADER_BTN_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-current opacity-70 transition-[opacity,background-color] duration-100 " +
  "hover:bg-black/15 hover:opacity-100 [&.has-comments]:bg-black/15 [&.has-comments]:opacity-100 " +
  "[&.has-open-popover]:bg-black/15 [&.has-open-popover]:opacity-100";

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

/**
 * `select-none`: without it, clicking one of these fast enough for the
 * browser to read it as a double-click selects the button's label text
 * instead of firing a second discrete click — the selection drag eats the
 * click that was supposed to toggle the attribute again, which is why
 * spam-clicking used to intermittently "lose" a click. The shared `Button`
 * component already carries this in its base class; these are hand-rolled
 * `<button>`s that had fallen out of that convention.
 */
export const KW_TOGGLE_BASE_CLASS =
  "flex select-none items-center justify-center gap-[5px] rounded-sm border border-border bg-bg px-2 py-[5px] text-[11px] " +
  "font-medium text-text-secondary transition-all duration-100 hover:bg-surface-hover hover:text-text";
/**
 * All four attribute toggles share one visual pattern — `text-{c}-hover
 * bg-{c}-light border-{c}-border` — so an active toggle always reads as
 * "tinted text + tinted fill + tinted border", never just one of the three.
 * Kept as literal strings (not built from a token name at runtime) because
 * Tailwind's JIT scanner only picks up class names it can see verbatim in
 * source.
 */
export const KW_TOGGLE_ACTIVE_CLASS: Record<"pk" | "unique" | "notNull" | "increment", string> = {
  pk: "font-semibold text-warning-hover bg-warning-light border-warning-border",
  unique: "font-semibold text-primary-hover bg-primary-light border-primary-border",
  notNull: "font-semibold text-info-hover bg-info-light border-info-border",
  increment: "font-semibold text-success-hover bg-success-light border-success-border",
};
