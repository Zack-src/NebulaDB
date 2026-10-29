/** The server's limits on the ignored list (`parseMonitorSettings`). */
export const MAX_IGNORE_TABLES = 200;
export const MAX_IGNORE_NAME = 128;

/** Tables of the schema the server would accept in the list, each once. */
export function pickableTables(tableNames: string[]): string[] {
  return [...new Set(tableNames)].filter((name) => name.length <= MAX_IGNORE_NAME);
}

/** The pickable tables that contain what was typed, case aside. */
export function matchingTables(pickable: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return needle ? pickable.filter((name) => name.toLowerCase().includes(needle)) : pickable;
}

/** A name typed in full that is neither in the schema nor already ignored: a table only the database has. */
export function typedTableName(pickable: string[], ignored: string[], query: string): string | null {
  const name = query.trim();
  if (name === "" || name.length > MAX_IGNORE_NAME) return null;
  return pickable.includes(name) || ignored.includes(name) ? null : name;
}

/** The ignored list with `name` added or removed; the same list when nothing changes or the cap is reached. */
export function toggleIgnoredTable(ignored: string[], name: string, on: boolean): string[] {
  const has = ignored.includes(name);
  if (on) return has || ignored.length >= MAX_IGNORE_TABLES ? ignored : [...ignored, name];
  return has ? ignored.filter((entry) => entry !== name) : ignored;
}
