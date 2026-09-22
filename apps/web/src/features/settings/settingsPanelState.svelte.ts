import { useAsyncAction } from "@/hooks/asyncAction.svelte";
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
import { applyThemePreset, loadThemePreset, saveThemePreset, type ThemePreset } from "@/utils/theme";

/** How long the "Updated!" confirmation stays up. */
const NAME_SAVED_FEEDBACK_MS = 3000;

export type SettingsTab = "profile" | "appearance" | "editor" | "team" | "billing" | "about";
export type { GridStyle, ThemePreset };

/**
 * State shared by the full-page (`SettingsPage`) and in-editor modal
 * (`SettingsModal`) settings surfaces — same six tabs, same local
 * preferences, two different shells around them.
 */
export function useSettingsPanelState(
  session: () => Session,
  onDisplayNameChange: (name: string) => Promise<void>,
) {
  let activeTab = $state<SettingsTab>("profile");
  let displayName = $state(session().displayName);
  let nameSavedSuccess = $state(false);
  let showChangePassword = $state(false);

  // Local-only preference (no server round-trip, same as the grid/snap/link
  // switches below). "obsidian" (dark) is the shipped default; "light" is
  // the other real option — "midnight"/"emerald" are still shown disabled in
  // the picker (`SettingsTabContent.svelte`), so picking one can't reach here.
  let themePreset = $state<ThemePreset>(loadThemePreset());

  // These three, by contrast, are real preferences the canvas reads. They used
  // to be plain state with no persistence and no consumer anywhere, so every
  // control on this tab was inert — the switches moved and nothing happened,
  // including after a reload.
  let gridStyle = $state<GridStyle>(loadGridStyle());
  let snapToGrid = $state<boolean>(loadSnapToGrid());
  let highlightLinks = $state<boolean>(loadHighlightLinks());

  // Through `useAsyncAction`, like every other mutation in the app. The
  // hand-rolled version swallowed the failure in a `console.error`, so a
  // rejected rename looked exactly like nothing having happened.
  const saveName = useAsyncAction(async (name: string) => {
    await onDisplayNameChange(name);
  });

  const handleSaveDisplayName = async (event: SubmitEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || name === session().displayName) return;
    nameSavedSuccess = false;
    if (await saveName.run(name)) {
      nameSavedSuccess = true;
      window.setTimeout(() => {
        nameSavedSuccess = false;
      }, NAME_SAVED_FEEDBACK_MS);
    }
  };

  return {
    get activeTab() {
      return activeTab;
    },
    setActiveTab: (tab: SettingsTab) => {
      activeTab = tab;
    },
    get displayName() {
      return displayName;
    },
    set displayName(next: string) {
      displayName = next;
    },
    get savingName() {
      return saveName.pending;
    },
    get nameSaveError() {
      return saveName.error;
    },
    get nameSavedSuccess() {
      return nameSavedSuccess;
    },
    get showChangePassword() {
      return showChangePassword;
    },
    setShowChangePassword: (show: boolean) => {
      showChangePassword = show;
    },
    get themePreset() {
      return themePreset;
    },
    setThemePreset: (preset: ThemePreset) => {
      saveThemePreset(preset);
      applyThemePreset(preset);
      themePreset = preset;
    },
    get gridStyle() {
      return gridStyle;
    },
    setGridStyle: (style: GridStyle) => {
      saveGridStyle(style);
      gridStyle = style;
    },
    get snapToGrid() {
      return snapToGrid;
    },
    setSnapToGrid: (enabled: boolean) => {
      saveSnapToGrid(enabled);
      snapToGrid = enabled;
    },
    get highlightLinks() {
      return highlightLinks;
    },
    setHighlightLinks: (enabled: boolean) => {
      saveHighlightLinks(enabled);
      highlightLinks = enabled;
    },
    handleSaveDisplayName,
  };
}

export type SettingsPanelState = ReturnType<typeof useSettingsPanelState>;
