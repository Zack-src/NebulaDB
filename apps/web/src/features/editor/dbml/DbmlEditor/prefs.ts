export const PREF_WRAP = "athanordb_dbml_wrap";
export const PREF_FONT = "athanordb_dbml_font_size";

export function readStoredWrap(): boolean {
  return localStorage.getItem(PREF_WRAP) !== "off";
}

export function readStoredFontSize(): number {
  const saved = Number(localStorage.getItem(PREF_FONT));
  return Number.isFinite(saved) && saved >= 10 && saved <= 24 ? saved : 13;
}
