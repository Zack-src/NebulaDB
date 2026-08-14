import { useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { Session } from "@/types/index";
import {
  loadGridStyle,
  loadHighlightLinks,
  loadSnapToGrid,
  saveGridStyle,
  saveHighlightLinks,
  saveSnapToGrid,
  type GridStyle,
} from "@/utils/preferences";

/** How long the "Updated!" confirmation stays up. */
const NAME_SAVED_FEEDBACK_MS = 3000;

export type SettingsTab = "profile" | "appearance" | "editor" | "team" | "billing" | "about";
export type ThemePreset = "obsidian" | "midnight" | "emerald" | "light";
export type { GridStyle };

/**
 * State shared by the full-page (`SettingsPage`) and in-editor modal
 * (`SettingsModal`) settings surfaces — same six tabs, same local
 * preferences, two different shells around them.
 */
export function useSettingsPanelState(session: Session, onDisplayNameChange: (name: string) => Promise<void>) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [displayName, setDisplayName] = useState(session.displayName);
  const [nameSavedSuccess, setNameSavedSuccess] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Theme is local-only for now (see docs/todo.md Phase 8: one dark theme
  // ships today). Only "obsidian" applies; the rest are shown disabled rather
  // than silently doing nothing when picked.
  const [themePreset, setThemePreset] = useState<ThemePreset>("obsidian");

  // These three, by contrast, are real preferences the canvas reads. They used
  // to be plain `useState` with no persistence and no consumer anywhere, so
  // every control on this tab was inert — the switches moved and nothing
  // happened, including after a reload.
  const [gridStyle, setGridStyleState] = useState<GridStyle>(loadGridStyle);
  const setGridStyle = (style: GridStyle) => {
    saveGridStyle(style);
    setGridStyleState(style);
  };
  const [snapToGrid, setSnapToGridState] = useState<boolean>(loadSnapToGrid);
  const setSnapToGrid = (enabled: boolean) => {
    saveSnapToGrid(enabled);
    setSnapToGridState(enabled);
  };
  const [highlightLinks, setHighlightLinksState] = useState<boolean>(loadHighlightLinks);
  const setHighlightLinks = (enabled: boolean) => {
    saveHighlightLinks(enabled);
    setHighlightLinksState(enabled);
  };

  // Through `useAsyncAction`, like every other mutation in the app. The
  // hand-rolled version swallowed the failure in a `console.error`, so a
  // rejected rename looked exactly like nothing having happened.
  const saveName = useAsyncAction(async (name: string) => {
    await onDisplayNameChange(name);
  });

  const handleSaveDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || name === session.displayName) return;
    setNameSavedSuccess(false);
    if (await saveName.run(name)) {
      setNameSavedSuccess(true);
      window.setTimeout(() => setNameSavedSuccess(false), NAME_SAVED_FEEDBACK_MS);
    }
  };

  return {
    activeTab,
    setActiveTab,
    displayName,
    setDisplayName,
    savingName: saveName.pending,
    nameSaveError: saveName.error,
    nameSavedSuccess,
    showChangePassword,
    setShowChangePassword,
    themePreset,
    setThemePreset,
    gridStyle,
    setGridStyle,
    snapToGrid,
    setSnapToGrid,
    highlightLinks,
    setHighlightLinks,
    handleSaveDisplayName,
  };
}
