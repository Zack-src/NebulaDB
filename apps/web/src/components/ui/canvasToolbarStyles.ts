/**
 * Floating canvas toolbars, in the dbdiagram/Figma shape: two separate pills
 * rather than one long bar — zoom sits bottom-left on its own, the editing
 * tools sit bottom-centre — with controls grouped by purpose and separated by
 * thin dividers.
 *
 * Sized for a pointer target rather than for density: 36px hit areas, which is
 * what both references use and what the previous 28px buttons were noticeably
 * short of.
 */

export const CANVAS_TOOLBAR_CLASS =
  "pointer-events-auto flex items-center gap-1 rounded-2xl border border-border-strong/60 bg-surface-raised p-1.5 shadow-[0_10px_32px_rgba(0,0,0,0.55)]";

export const CANVAS_TOOLBAR_DIVIDER_CLASS = "mx-1.5 h-6 w-px shrink-0 bg-border";

/**
 * Neither base class sets a background: the reset in `styles/base.css` already
 * gives every button `background: none`, and a `bg-transparent` here would
 * compete with the active-state background below. Two utilities from the same
 * Tailwind group resolve by stylesheet order, not by the order they appear in
 * the class attribute — so `bg-transparent` silently won and the "on" state
 * never painted.
 */

/** Square icon button — the toolbar's default control. */
export const CANVAS_TOOLBAR_ICON_BTN_CLASS =
  "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 p-0 text-text-secondary transition-colors duration-100 hover:bg-white/10 hover:text-text disabled:pointer-events-none disabled:opacity-40";

/** Text/label control — detail level, zoom percentage, font-size steppers. */
export const CANVAS_TOOLBAR_SEGMENT_CLASS =
  "flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-0 px-2.5 text-[12.5px] font-medium text-text-secondary transition-colors duration-100 hover:bg-white/10 hover:text-text disabled:pointer-events-none disabled:opacity-40";

/**
 * A trigger whose popover is currently open. Deliberately *not* the same as the
 * toggle style below: an open menu is a transient state, so it reads as a held
 * hover — reserving the solid fill for "this mode is on" keeps the two
 * distinguishable at a glance.
 */
export const CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS = "bg-white/10 text-text";

/** Toggle in its "on" state (link highlight, minimap, search) — solid fill, the way Figma marks the active tool. */
export const CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS =
  "bg-primary text-white shadow-sm hover:bg-primary-hover hover:text-white";
