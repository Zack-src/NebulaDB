/**
 * Shared shell classNames.
 *
 * `APP_HEADER` is 48px, matching the shared workspace shell and the redesign.
 *
 * It also uses a flat surface plus a hairline rather than `.glass-panel`: that
 * class sets a *background* and a blur, and the headers that reached for it
 * ended up relying on it for their border too. One opaque recipe reads the
 * same everywhere and cannot be undercut by whatever happens to scroll behind
 * it.
 */
export const APP_SHELL = "flex h-screen w-screen flex-col bg-bg";
export const APP_HEADER =
  "z-30 flex h-12 shrink-0 select-none items-center gap-2.5 border-b border-border bg-surface px-4 sm:px-6";
