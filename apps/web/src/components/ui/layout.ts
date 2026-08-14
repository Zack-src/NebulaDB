/**
 * Shared shell classNames.
 *
 * `APP_HEADER` is 56px like every other top-level header in the app — it used
 * to be 50px, which is why moving between the project list, the admin console
 * and the editor shifted the whole page up and down by six pixels.
 *
 * It also uses a flat surface plus a hairline rather than `.glass-panel`: that
 * class sets a *background* and a blur, and the headers that reached for it
 * ended up relying on it for their border too. One opaque recipe reads the
 * same everywhere and cannot be undercut by whatever happens to scroll behind
 * it.
 */
export const APP_SHELL = "flex h-screen w-screen flex-col bg-bg";
export const APP_HEADER =
  "z-30 flex h-14 shrink-0 select-none items-center gap-2.5 border-b border-border bg-surface px-4 shadow-xs sm:px-6";
/** Hairline separating groups of controls inside a header. */
export const HEADER_DIVIDER = "mx-1 h-5 w-px shrink-0 bg-border";
