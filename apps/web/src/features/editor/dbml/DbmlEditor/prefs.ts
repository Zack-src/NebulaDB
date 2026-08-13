import { readNumberInRange, readString, writeString } from "@/utils/storage";

export const PREF_WRAP = "athanordb_dbml_wrap";
export const PREF_FONT = "athanordb_dbml_font_size";

const MIN_FONT = 10;
const MAX_FONT = 24;
const DEFAULT_FONT = 13;

export function readStoredWrap(): boolean {
  return readString(PREF_WRAP) !== "off";
}

export function writeStoredWrap(wrap: boolean): void {
  writeString(PREF_WRAP, wrap ? "on" : "off");
}

export function readStoredFontSize(): number {
  return readNumberInRange(PREF_FONT, MIN_FONT, MAX_FONT, DEFAULT_FONT);
}

export function writeStoredFontSize(size: number): void {
  writeString(PREF_FONT, String(size));
}
