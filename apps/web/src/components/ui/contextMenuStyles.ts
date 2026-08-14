/**
 * Shared visual style for right-click context menus (canvas, edges).
 *
 * One recipe for every menu in the app: same width floor, same padding, same
 * elevation. They used to diverge — the edge menu was a glass panel with a
 * heavier shadow and a larger radius than the canvas one — which read as two
 * different components for what is, to the user, the same gesture.
 */
export const CONTEXT_MENU_CLASS =
  "fixed z-[var(--z-context-menu)] min-w-[184px] max-w-[min(280px,calc(100vw-16px))] animate-modal-in overflow-hidden " +
  "rounded-md border border-border-strong bg-surface-raised p-1 shadow-lg";

export const CONTEXT_MENU_ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] font-medium " +
  "text-text-secondary transition-colors duration-100 [&>svg]:shrink-0 [&>svg]:text-text-muted " +
  "hover:bg-surface-hover hover:text-text hover:[&>svg]:text-text " +
  "focus-visible:bg-surface-hover focus-visible:text-text focus-visible:outline-hidden";

/** Destructive entry — same geometry, danger colouring. */
export const CONTEXT_MENU_DANGER_ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] font-medium " +
  "text-danger transition-colors duration-100 [&>svg]:shrink-0 " +
  "hover:bg-danger-light hover:text-danger-hover focus-visible:bg-danger-light focus-visible:outline-hidden";

/** Hairline between groups of entries. */
export const CONTEXT_MENU_SEPARATOR_CLASS = "my-1 h-px bg-border";
