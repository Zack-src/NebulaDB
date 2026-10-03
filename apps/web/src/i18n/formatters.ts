import type { Locale } from "./translate";

/**
 * Locale-aware formatting for values that are not translated strings but still
 * change shape per locale — dates, numbers, relative times. Kept out of the
 * dictionary because a date format is a rule, not a phrase.
 */

/**
 * A date from the server. SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC with no
 * zone, which `new Date()` would read as local time — hours off for anyone
 * not on UTC. Such a value is read as UTC; anything carrying a zone (ISO with
 * `Z` or an offset) or a `Date` is taken as it is.
 */
export function toDate(value: string | Date): Date {
  if (typeof value !== "string") return value;
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
    ? new Date(`${value.replace(" ", "T")}Z`)
    : new Date(value);
}

export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(toDate(value));
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(toDate(value));
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "il y a 3 jours" / "3 days ago" — picks the largest unit the difference fills. */
export function formatRelativeTime(value: string | Date, locale: Locale): string {
  const deltaMs = toDate(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= unitMs) return formatter.format(Math.round(deltaMs / unitMs), unit);
  }
  return formatter.format(Math.round(deltaMs / 1000), "second");
}
