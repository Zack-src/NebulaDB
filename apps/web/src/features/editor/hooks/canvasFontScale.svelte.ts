import { FONT_SCALE_MAX, FONT_SCALE_MIN, loadFontScale, saveFontScale } from "@/utils/preferences";

/** Canvas text-size preference, persisted on change. */
export function useCanvasFontScale() {
  let fontScale = $state(loadFontScale());

  return {
    get fontScale() {
      return fontScale;
    },
    adjustFontScale: (delta: number) => {
      fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round((fontScale + delta) * 100) / 100));
      saveFontScale(fontScale);
    },
  };
}
