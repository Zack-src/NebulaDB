/** Shared visual style for right-click context menus (canvas, edges) — apply to the popover container/menu items. */
export const CONTEXT_MENU_CLASS =
  "fixed z-[2000] min-w-[168px] animate-modal-in rounded-md border border-border bg-surface-raised p-1 shadow-lg";

export const CONTEXT_MENU_ITEM_CLASS =
  "flex w-full items-center gap-[9px] rounded-sm px-2.5 py-[7px] text-left text-[13px] text-text-secondary " +
  "[&>svg]:shrink-0 [&>svg]:text-text-muted hover:bg-primary-light hover:text-text";
