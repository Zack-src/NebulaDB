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
  "pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-border-strong bg-surface-raised p-1.5 shadow-lg";

export const CANVAS_TOOLBAR_DIVIDER_CLASS = "mx-1 h-5 w-px shrink-0 bg-border";

const TOOLBAR_BTN_BASE =
  "flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 " +
  "text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary " +
  "disabled:pointer-events-none disabled:opacity-40";

/**
 * Neither base class sets a background. The "on" state below paints one, and
 * two utilities from the same Tailwind group resolve by stylesheet order rather
 * than by the order they appear in the class attribute — so a `bg-transparent`
 * here would silently win and the toggle would never look enabled.
 */

/** Square icon button — the toolbar's default control. */
export const CANVAS_TOOLBAR_ICON_BTN_CLASS = `${TOOLBAR_BTN_BASE} w-9 p-0`;

/** Text/label control — detail level, zoom percentage, font-size steppers. */
export const CANVAS_TOOLBAR_SEGMENT_CLASS = `${TOOLBAR_BTN_BASE} gap-1.5 px-2.5 text-[12.5px] font-medium`;

/**
 * A trigger whose popover is currently open. Deliberately *not* the same as the
 * toggle style below: an open menu is a transient state, so it reads as a held
 * hover — reserving the solid fill for "this mode is on" keeps the two
 * distinguishable at a glance.
 */
export const CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS = "bg-surface-hover text-text";

/** Toggle in its "on" state (link highlight, minimap, search) — solid fill, the way Figma marks the active tool. */
export const CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS =
  "bg-primary text-white hover:bg-primary-hover hover:text-white";
