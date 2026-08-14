/**
 * Shared visual language for every text field, select and textarea.
 *
 * One base recipe, three sizes, on the same 24/28/32 height ramp as `Button` —
 * so a field and a button side by side in a toolbar or form row share a
 * baseline. Callers pass only layout classes (width/flex) — never their own
 * padding or height, so sizing stays consistent and Tailwind class ordering
 * can't fight the base.
 *
 * Fields read as a quiet well: a flat darker fill, a hairline border that
 * firms up on hover, and a primary border plus a soft ring on focus. The fill
 * itself does not change on hover — a field that lights up under the cursor
 * reads as a button, which is precisely the wrong affordance.
 */
const INPUT_BASE =
  "rounded-md border border-border bg-surface text-text caret-primary " +
  "placeholder:text-text-muted " +
  "transition-[border-color,box-shadow] duration-150 ease-out " +
  "enabled:hover:border-border-strong " +
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 " +
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
export const SELECT_SM_CLASS = `${INPUT_SM_CLASS} app-select cursor-pointer pr-6`;

export const TEXTAREA_CLASS = `${INPUT_BASE} block min-h-[84px] px-2.5 py-2 text-[13px] leading-relaxed`;
/** Compact multi-line field — comment composer, inline notes. */
export const TEXTAREA_SM_CLASS = `${INPUT_BASE} block min-h-[44px] resize-none px-2 py-1.5 text-[12.5px] leading-normal`;
/** Monospace code-editing textarea (DBML/SQL source panes) — no resize handle. */
export const TEXTAREA_CODE_CLASS = `${TEXTAREA_CLASS} resize-none font-mono text-[12.5px] leading-normal`;

/** Native checkbox, tinted to the accent colour instead of the UA blue. */
export const CHECKBOX_CLASS =
  "h-[15px] w-[15px] shrink-0 cursor-pointer accent-primary " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Label sitting above a field. */
export const LABEL_CLASS = "text-[12px] font-medium text-text-secondary";
/** Smaller label for canvas popovers. */
export const LABEL_XS_CLASS = "text-[11px] font-medium text-text-muted";
