/**
 * Shared visual language for text fields, selects and textareas: one base recipe, three sizes
 * on the same 24/28/32 height ramp as `Button`. Callers pass only layout classes, never their
 * own padding or height. A quiet well that firms up on hover and rings on focus; the fill
 * doesn't change on hover, which would read as a button.
 */
const INPUT_BASE =
  "rounded-md border border-border-control bg-surface-raised text-text caret-primary " +
  "placeholder:text-text-muted " +
  "transition-[border-color,box-shadow] duration-150 ease-out " +
  "enabled:hover:border-border-strong " +
  "focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/25 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Default field — 32px tall. Forms, dialogs, page-level inputs. */
export const INPUT_CLASS = `${INPUT_BASE} h-8 px-2.5 text-[13px]`;
/** Compact field — 28px tall. Toolbars, inline edits, list rows. */
export const INPUT_SM_CLASS = `${INPUT_BASE} h-7 px-2 text-[12.5px]`;
/** Dense field — 24px tall. Popovers on the canvas, where vertical space is tight. */
export const INPUT_XS_CLASS = `${INPUT_BASE} h-6 px-2 text-[12px]`;

/** Add to any field to mark it invalid (red border + red focus ring). */
export const INPUT_INVALID_CLASS = "!border-danger focus:!ring-danger/25";

/** `.app-select` (styles/utilities.css) draws the chevron; the reset hides the native one. */
export const SELECT_CLASS = `${INPUT_CLASS} app-select cursor-pointer pr-7`;
export const TEXTAREA_CLASS = `${INPUT_BASE} block min-h-[84px] px-2.5 py-2 text-[13px] leading-relaxed`;
/** Compact multi-line field — comment composer, inline notes. */
export const TEXTAREA_SM_CLASS = `${INPUT_BASE} block min-h-[44px] resize-none px-2 py-1.5 text-[12.5px] leading-normal`;
/** Monospace code-editing textarea (DBML/SQL source panes) — no resize handle. */
export const TEXTAREA_CODE_CLASS = `${TEXTAREA_CLASS} resize-none font-mono text-[12.5px] leading-normal`;

/** Label sitting above a field. */
export const LABEL_CLASS = "text-[12px] font-medium text-text-secondary";
/** Smaller label for canvas popovers. */
export const LABEL_XS_CLASS = "text-[11px] font-medium text-text-muted";
