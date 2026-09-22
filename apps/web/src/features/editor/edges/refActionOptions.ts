import type { RefAction } from "@athanordb/shared";
import type { TranslationKey } from "@/i18n/translate";

/** Every value the DBML/SQL-standard `[delete: ...]`/`[update: ...]` action vocabulary supports — shared between `EdgeSettingsPopover` (the relation's own settings) and `FieldEditorPopover` (the same setting, reachable from the FK column itself). `undefined` means "unset", left to the database's own default. */
export const REF_ACTIONS: RefAction[] = ["cascade", "restrict", "set null", "set default", "no action"];

export const REF_ACTION_LABEL_KEY: Record<RefAction, TranslationKey> = {
  cascade: "edge.action.cascade",
  restrict: "edge.action.restrict",
  "set null": "edge.action.setNull",
  "set default": "edge.action.setDefault",
  "no action": "edge.action.noAction",
};

export const ACTION_SELECT_CLASS =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text " +
  "focus:border-primary focus:outline-none";
