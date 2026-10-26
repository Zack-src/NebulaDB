/**
 * The SQL a person was typing in a database's console, kept while they look at another tab or
 * another database: the console is unmounted when they leave it. Held in memory and, best effort,
 * in `sessionStorage` so a reload of the page does not lose it either. Per browser tab, never sent anywhere.
 */
const STORAGE_PREFIX = "nebuladb.sqlDraft.";
const drafts = new Map<string, string>();

export function getSqlDraft(key: string): string {
  const held = drafts.get(key);
  if (held !== undefined) return held;
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key) ?? "";
  } catch {
    // Storage blocked (private window, site data cleared): the in-memory copy is all there is.
    return "";
  }
}

export function setSqlDraft(key: string, sql: string): void {
  drafts.set(key, sql);
  try {
    if (sql) sessionStorage.setItem(STORAGE_PREFIX + key, sql);
    else sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // See `getSqlDraft`.
  }
}
