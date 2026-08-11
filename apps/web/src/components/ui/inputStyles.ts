/**
 * Shared visual language for every text field, select and textarea.
 *
 * One base recipe, three sizes. Fields read as a slightly inset well (subtle
 * inner shadow + darker fill than the surface they sit on), get a stronger
 * border on hover, and a primary border + soft ring on focus. Callers pass only
 * layout classes (width/flex) — never their own padding or height, so sizing
 * stays consistent and Tailwind class ordering can't fight the base.
 */
const INPUT_BASE =
  "rounded-lg border border-border/80 bg-surface/80 text-text caret-primary " +
  "placeholder:text-text-muted " +
  "transition-all duration-150 ease-out " +
  "enabled:hover:border-border-strong enabled:hover:bg-surface-hover/80 " +
  "focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 " +
  "disabled:cursor-not-allowed disabled:opacity-50";


/** Default field — 36px tall. Forms, dialogs, page-level inputs. */
export const INPUT_CLASS = `${INPUT_BASE} h-9 px-3 text-[13px]`;
/** Compact field — 30px tall. Toolbars, inline edits, list rows. */
export const INPUT_SM_CLASS = `${INPUT_BASE} h-[30px] px-2.5 text-[12.5px]`;
/** Dense field — 26px tall. Popovers on the canvas, where vertical space is tight. */
export const INPUT_XS_CLASS = `${INPUT_BASE} h-[26px] px-2 text-[12px]`;

/** Add to any field to mark it invalid (red border + red focus ring). */
export const INPUT_INVALID_CLASS = "!border-danger focus:!ring-danger-light";

/** `.app-select` (index.css) draws the chevron; `appearance-none` hides the native one. */
export const SELECT_CLASS = `${INPUT_CLASS} app-select cursor-pointer pr-8`;
export const SELECT_SM_CLASS = `${INPUT_SM_CLASS} app-select cursor-pointer pr-7`;

export const TEXTAREA_CLASS = `${INPUT_BASE} block min-h-[84px] px-3 py-2 text-[13px] leading-relaxed`;
/** Compact multi-line field — comment composer, inline notes. */
export const TEXTAREA_SM_CLASS = `${INPUT_BASE} block min-h-[44px] resize-none px-2.5 py-1.5 text-[12.5px] leading-normal`;
/** Monospace code-editing textarea (DBML/SQL source panes) — no resize handle. */
export const TEXTAREA_CODE_CLASS = `${TEXTAREA_CLASS} resize-none font-mono text-[12.5px] leading-normal`;

/** Native checkbox, tinted to the accent colour instead of the UA blue. */
export const CHECKBOX_CLASS =
  "h-[15px] w-[15px] shrink-0 cursor-pointer accent-primary " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-border";

/** Label sitting above a field. */
export const LABEL_CLASS = "text-[12px] font-medium text-text-secondary";
/** Smaller label for canvas popovers. */
export const LABEL_XS_CLASS = "text-[11px] font-medium text-text-muted";
