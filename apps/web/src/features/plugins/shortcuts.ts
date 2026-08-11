/**
 * Shortcut parsing shared by the registry (which detects collisions) and the
 * two places that actually bind keys: the canvas (global) and the DBML editor
 * (only while it has focus). Kept apart from the registry so the editor
 * doesn't have to import the whole plugin store to match a keystroke.
 */

const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"];

/** `"ctrl+alt+s"` from any reasonable spelling, or `null` when unusable. */
export function normalizeShortcut(shortcut: string): string | null {
  const parts = shortcut
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set(parts.map((m) => (m === "control" ? "ctrl" : m === "option" ? "alt" : m === "cmd" ? "meta" : m)));
  // A bare letter would fight with typing, so at least one modifier is required.
  if (mods.size === 0) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** The same normalized form for a live keyboard event, so the two can be compared. */
export function shortcutFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

/** First entry whose shortcut matches the event — `undefined` when none does. */
export function matchShortcut<T extends { shortcut?: string }>(items: readonly T[], event: KeyboardEvent): T | undefined {
  const pressed = shortcutFromEvent(event);
  return items.find((item) => item.shortcut && normalizeShortcut(item.shortcut) === pressed);
}
