import { useEffect, useState } from "react";
import { FONT_SCALE_MAX, FONT_SCALE_MIN, loadFontScale, saveFontScale } from "@/utils/preferences";

/** Canvas text-size preference, persisted on change. */
export function useCanvasFontScale() {
  const [fontScale, setFontScale] = useState(loadFontScale);

  useEffect(() => {
    saveFontScale(fontScale);
  }, [fontScale]);

  const adjustFontScale = (delta: number) => {
    setFontScale((current) =>
      Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round((current + delta) * 100) / 100)),
    );
  };

  return { fontScale, adjustFontScale };
}
