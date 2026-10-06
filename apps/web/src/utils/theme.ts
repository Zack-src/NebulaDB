import { readString, writeString } from "./storage";

/**
 * Dark ("obsidian") ships as the unconditional CSS default (see
 * `styles/tokens.css`) so a failed/blocked script still renders the app's
 * intended look. `midnight`/`emerald` are reserved ids the settings UI
 * already shows as "coming soon" — no CSS backs them yet, so applying either
 * one today is a no-op past `obsidian`'s own default.
 */
export type ThemePreset = "obsidian" | "midnight" | "emerald" | "light";
const THEME_PRESETS: ThemePreset[] = ["obsidian", "midnight", "emerald", "light"];

const KEY = "nebuladb.theme";

export function loadThemePreset(): ThemePreset {
  const stored = readString(KEY);
  return THEME_PRESETS.includes(stored as ThemePreset) ? (stored as ThemePreset) : "obsidian";
}

export function saveThemePreset(preset: ThemePreset): void {
  writeString(KEY, preset);
}

/**
 * Sets (or clears) `data-theme` on `<html>`. Only `"light"` has a CSS block today; every other
 * preset clears the attribute, falling back to dark. Framework-free: `index.html`'s boot script
 * duplicates this logic to paint the right theme before first paint.
 */
export function applyThemePreset(preset: ThemePreset): void {
  if (preset === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
