import type { TranslationKeyOf } from "@/types";

/** The admin console's tabs, shared with the global palette that jumps to them. */
export const ADMIN_SECTIONS = [
  { key: "teams", labelKey: "admin.section.teams" },
  { key: "users", labelKey: "admin.section.users" },
  { key: "audit", labelKey: "admin.section.activity" },
  { key: "errors", labelKey: "admin.section.errors" },
  { key: "connections", labelKey: "admin.section.connections" },
  { key: "environments", labelKey: "admin.section.environments" },
  { key: "lint", labelKey: "admin.section.lint" },
  { key: "sso", labelKey: "admin.section.sso" },
  { key: "shareLinks", labelKey: "admin.section.shareLinks" },
] as const satisfies readonly { key: string; labelKey: TranslationKeyOf }[];

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["key"];
