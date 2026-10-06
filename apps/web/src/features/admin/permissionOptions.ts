import type { PermissionLevel, TranslationKeyOf } from "@/types";

const PERMISSION_LEVELS: PermissionLevel[] = ["view", "edit", "administrator"];

const PERMISSION_LABEL_KEY = {
  view: "permission.view",
  edit: "permission.edit",
  administrator: "permission.administrator",
} as const satisfies Record<PermissionLevel, TranslationKeyOf>;

/** The three project levels as options of a `Select`, in the caller's language. */
export function permissionOptions(t: (key: TranslationKeyOf) => string): { value: PermissionLevel; label: string }[] {
  return PERMISSION_LEVELS.map((level) => ({ value: level, label: t(PERMISSION_LABEL_KEY[level]) }));
}
