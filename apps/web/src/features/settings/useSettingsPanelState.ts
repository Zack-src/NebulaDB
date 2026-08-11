import { useState } from "react";
import type { Session } from "@/types/index";

export type SettingsTab = "profile" | "appearance" | "editor" | "team" | "billing" | "about";
export type ThemePreset = "obsidian" | "midnight" | "emerald" | "light";
export type GridStyle = "dots" | "lines" | "cross";
export type AutoLayoutAlgo = "dagre" | "force";

/**
 * State shared by the full-page (`SettingsPage`) and in-editor modal
 * (`SettingsModal`) settings surfaces — same six tabs, same local
 * preferences, two different shells around them.
 */
export function useSettingsPanelState(session: Session, onDisplayNameChange: (name: string) => void) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [displayName, setDisplayName] = useState(session.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameSavedSuccess, setNameSavedSuccess] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Local-only preferences — not yet persisted anywhere (see docs/todo.md
  // Phase 8: single dark theme shipped today, no light variant or toggle).
  // Only "obsidian" actually applies; the rest are previewed but disabled
  // rather than silently doing nothing when picked.
  const [themePreset, setThemePreset] = useState<ThemePreset>("obsidian");
  const [gridStyle, setGridStyle] = useState<GridStyle>("dots");
  const [autoLayoutAlgo, setAutoLayoutAlgo] = useState<AutoLayoutAlgo>("dagre");

  const handleSaveDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!displayName.trim() || displayName === session.displayName) return;
    setSavingName(true);
    setNameSavedSuccess(false);
    try {
      await onDisplayNameChange(displayName.trim());
      setNameSavedSuccess(true);
      setTimeout(() => setNameSavedSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingName(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    displayName,
    setDisplayName,
    savingName,
    nameSavedSuccess,
    showChangePassword,
    setShowChangePassword,
    themePreset,
    setThemePreset,
    gridStyle,
    setGridStyle,
    autoLayoutAlgo,
    setAutoLayoutAlgo,
    handleSaveDisplayName,
  };
}
