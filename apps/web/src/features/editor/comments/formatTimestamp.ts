/** "2026-07-29T09:31:59.868Z" -> "2026-07-29 09:31:59" — matches the plain UTC-timestamp style the revision history list already uses. */
export function formatTimestamp(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}
