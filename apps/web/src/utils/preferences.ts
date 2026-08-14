import type { Viewport } from "@xyflow/react";
import { isSupportedLocale, type Locale } from "@/i18n/translate";
import { readBoolean, readJson, readNumberInRange, readString, writeBoolean, writeJson, writeString } from "./storage";

/**
 * Personal display preferences — things that belong to one person on one
 * browser, not to the shared project document. Every key is namespaced so the
 * app's storage stays identifiable next to anything else on the origin.
 */

const KEY = {
  fontScale: "athanordb.canvasFontScale",
  highlightLinks: "athanordb.highlightLinks",
  showMinimap: "athanordb.showMinimap",
  locale: "athanordb.locale",
  dbmlPanelWidth: "athanordb.dbmlPanelWidth",
} as const;

// Width of the DBML side panel. Lives here rather than in the panel so the
// reader and the drag clamp cannot disagree about the bounds — and so the read
// goes through the guarded storage wrapper: a direct `localStorage` call throws
// outright in a browser with site data blocked, and this one ran during render.
export const DBML_PANEL_WIDTH_MIN = 280;
export const DBML_PANEL_WIDTH_MAX = 1200;
export const DBML_PANEL_WIDTH_DEFAULT = 440;

export function loadDbmlPanelWidth(): number {
  return readNumberInRange(KEY.dbmlPanelWidth, DBML_PANEL_WIDTH_MIN, DBML_PANEL_WIDTH_MAX, DBML_PANEL_WIDTH_DEFAULT);
}

export function saveDbmlPanelWidth(width: number): void {
  writeString(KEY.dbmlPanelWidth, String(width));
}

// Canvas text size (accessibility).
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.15;
const FONT_SCALE_DEFAULT = 1;

export function loadFontScale(): number {
  return readNumberInRange(KEY.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_DEFAULT);
}

export function saveFontScale(scale: number): void {
  writeString(KEY.fontScale, String(scale));
}

/**
 * Canvas pan/zoom is specific to a (project, user) pair rather than the project
 * itself: two people on the same project shouldn't yank each other's viewport
 * around, and one person's saved position shouldn't follow them into a
 * different project. Keyed by the session's stable user id (not the editable
 * display name) so renaming yourself doesn't lose it.
 */
export function viewportKey(projectId: string, userId: string): string {
  return `athanordb.viewport.${projectId}.${userId}`;
}

export function loadViewport(projectId: string, userId: string): Viewport | null {
  return readJson<Viewport>(viewportKey(projectId, userId));
}

export function saveViewport(projectId: string, userId: string, viewport: Viewport): void {
  writeJson(viewportKey(projectId, userId), viewport);
}

export function loadHighlightLinks(): boolean {
  return readBoolean(KEY.highlightLinks, false);
}

export function saveHighlightLinks(enabled: boolean): void {
  writeBoolean(KEY.highlightLinks, enabled);
}

export function loadShowMinimap(): boolean {
  return readBoolean(KEY.showMinimap, true);
}

export function saveShowMinimap(visible: boolean): void {
  writeBoolean(KEY.showMinimap, visible);
}

/** `null` means "never chosen" — the provider then follows the browser's own preference. */
export function loadLocale(): Locale | null {
  const stored = readString(KEY.locale);
  return isSupportedLocale(stored) ? stored : null;
}

export function saveLocale(locale: Locale): void {
  writeString(KEY.locale, locale);
}
