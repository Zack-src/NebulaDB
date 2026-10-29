/** What the server accepts as a project's database on a connection (see `LINK_DATABASE_NAME` there). */
const DATABASE_NAME = /^[A-Za-z0-9_$.-]{1,128}$/;

export interface ProjectDatabaseRow {
  projectId: string;
  /** In the trash: it keeps its link but holds no database, so it takes none from another project. */
  trashed: boolean;
  /** What was typed; empty is the connection's own database. */
  value: string;
}

export type ProjectDatabaseIssue = "invalid" | "duplicate";

/**
 * The rows the server would refuse, by project id: a name outside the allowed
 * pattern, or a database that two projects would share — compared without
 * regard to case, an empty value being the connection's own database.
 */
export function findDatabaseIssues(rows: ProjectDatabaseRow[], ownDatabase: string): Map<string, ProjectDatabaseIssue> {
  const issues = new Map<string, ProjectDatabaseIssue>();
  const holders = new Map<string, string[]>();
  for (const row of rows) {
    const name = row.value.trim();
    if (name && !DATABASE_NAME.test(name)) {
      issues.set(row.projectId, "invalid");
      continue;
    }
    if (row.trashed) continue;
    const key = (name || ownDatabase.trim()).toLowerCase();
    holders.set(key, [...(holders.get(key) ?? []), row.projectId]);
  }
  for (const ids of holders.values()) {
    if (ids.length > 1) for (const id of ids) issues.set(id, "duplicate");
  }
  return issues;
}
