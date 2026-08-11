import type { Locale } from "./translate";

/**
 * Locale-aware formatting for values that are not translated strings but still
 * change shape per locale — dates, numbers, relative times. Kept out of the
 * dictionary because a date format is a rule, not a phrase.
 */

export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
  const deltaMs = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= unitMs) return formatter.format(Math.round(deltaMs / unitMs), unit);
  }
  return formatter.format(Math.round(deltaMs / 1000), "second");
}
