import { formatDate, formatRelativeTime } from "@/i18n/formatters";
import type { I18nContextValue } from "@/i18n/i18n.svelte";
import type { Locale } from "@/i18n/translate";
import type { ShareContent, ShareLink, ShareLinkStatus } from "@/services/shareLinksApi";
import type { TranslationKeyOf } from "@/types";

/** How a share link reads in the project's list and in the admin console. */

export const SHARE_CONTENT_KEY = {
  both: "shareLinks.shows.both",
  diagram: "shareLinks.shows.diagram",
  dictionary: "shareLinks.shows.dictionary",
} as const satisfies Record<ShareContent, TranslationKeyOf>;

export const SHARE_STATUS_KEY = {
  active: "shareLinks.status.active",
  expired: "shareLinks.status.expired",
  revoked: "shareLinks.status.revoked",
} as const satisfies Record<ShareLinkStatus, TranslationKeyOf>;

export const SHARE_STATUS_TONE = { active: "success", expired: "muted", revoked: "danger" } as const satisfies Record<
  ShareLinkStatus,
  "success" | "muted" | "danger"
>;

/** "Expires on 12/11/2026 · 3 views · last viewed 2 hours ago" — the expiry only while the link still works. */
export function shareLinkFacts(link: ShareLink, t: I18nContextValue["t"], locale: Locale): string {
  return [
    link.status === "active" ? t("shareLinks.expiresOn", { date: formatDate(link.expiresAt, locale) }) : null,
    t("shareLinks.views", { count: link.viewCount }),
    link.lastViewedAt ? t("shareLinks.lastViewed", { time: formatRelativeTime(link.lastViewedAt, locale) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
