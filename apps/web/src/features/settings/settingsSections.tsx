import type { ReactNode } from "react";
import { CreditCardIcon, InfoIcon, PaletteIcon, SlidersIcon, UserIcon, UsersIcon } from "@/components/icons/Icons";
import type { TranslationKeyOf } from "@/types";
import type { SettingsTab } from "./useSettingsPanelState";

export interface SettingsSection {
  id: SettingsTab;
  labelKey: TranslationKeyOf;
  icon: ReactNode;
}

/**
 * The settings nav, shared by the full-page and in-editor shells. Both used to
 * carry their own copy — with different labels and, in the modal, emoji instead
 * of the app's own icon set, so the same six tabs read as two different
 * features depending on where you opened them.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "profile", labelKey: "settings.section.profile", icon: <UserIcon size={16} /> },
  { id: "appearance", labelKey: "settings.section.appearance", icon: <PaletteIcon size={16} /> },
  { id: "editor", labelKey: "settings.section.editor", icon: <SlidersIcon size={16} /> },
  { id: "team", labelKey: "settings.section.team", icon: <UsersIcon size={16} /> },
  { id: "billing", labelKey: "settings.section.billing", icon: <CreditCardIcon size={16} /> },
  { id: "about", labelKey: "settings.section.about", icon: <InfoIcon size={16} /> },
];
