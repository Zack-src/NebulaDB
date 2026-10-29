import type {
  DbAccessGrant,
  DbAccessGrantInput,
  DbAccessLevel,
  InheritedDbAccess,
  UserDbAccess,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";

/**
 * Who may use a connection's console without being an instance administrator. A grant names
 * a connection, a subject (user, or team) and a level; project membership gives nothing.
 *
 * Read on every request, never cached, so revocations apply immediately. Foreign keys are off
 * in this database: user, team, connection and project deletions remove these rows themselves.
 */

const RANK: Record<DbAccessLevel, number> = { read: 1, write: 2 };

function highest(levels: DbAccessLevel[]): DbAccessLevel | null {
  return levels.reduce<DbAccessLevel | null>((best, level) => (!best || RANK[level] > RANK[best] ? level : best), null);
}

/** The highest level this user holds on this connection, directly or through a team; `null` for none. */
export async function effectiveDbAccess(userId: string, connectionId: string): Promise<DbAccessLevel | null> {
  const rows = (await db
    .prepare(
      `SELECT level FROM db_access_grants
        WHERE connection_id = ?
          AND ((subject_type = 'user' AND subject_id = ?)
            OR (subject_type = 'team' AND subject_id IN (SELECT team_id FROM team_members WHERE user_id = ?)))`,
    )
    .all(connectionId, userId, userId)) as { level: DbAccessLevel }[];
  return highest(rows.map((row) => row.level));
}

/** Every connection this user may query, with the highest level held on each. */
export async function listAccessibleConnections(
  userId: string,
): Promise<{ connectionId: string; level: DbAccessLevel }[]> {
  const rows = (await db
    .prepare(
      `SELECT g.connection_id AS "connectionId", g.level AS level
         FROM db_access_grants g JOIN db_connections c ON c.id = g.connection_id
        WHERE (g.subject_type = 'user' AND g.subject_id = ?)
           OR (g.subject_type = 'team' AND g.subject_id IN (SELECT team_id FROM team_members WHERE user_id = ?))`,
    )
    .all(userId, userId)) as { connectionId: string; level: DbAccessLevel }[];
  const best = new Map<string, DbAccessLevel>();
  for (const row of rows) {
    const current = best.get(row.connectionId);
    best.set(row.connectionId, current && RANK[current] >= RANK[row.level] ? current : row.level);
  }
  return [...best].map(([connectionId, level]) => ({ connectionId, level }));
}

/** A user's own grants and account names, and what their teams give them. */
export async function getUserDbAccess(userId: string): Promise<UserDbAccess> {
  const grants = (await db
    .prepare(
      `SELECT c.id AS "connectionId", c.name AS "connectionName", g.level AS level, h.username AS "sqlUsername"
         FROM db_connections c
         LEFT JOIN db_access_grants g ON g.connection_id = c.id AND g.subject_type = 'user' AND g.subject_id = ?
         LEFT JOIN db_account_hints h ON h.connection_id = c.id AND h.user_id = ?
        WHERE g.level IS NOT NULL OR h.username IS NOT NULL
        ORDER BY LOWER(c.name)`,
    )
    .all(userId, userId)) as DbAccessGrant[];
  const inherited = (await db
    .prepare(
      `SELECT c.id AS "connectionId", c.name AS "connectionName", g.level AS level, t.id AS "teamId", t.name AS "teamName"
         FROM db_access_grants g
         JOIN team_members tm ON tm.team_id = g.subject_id AND tm.user_id = ?
         JOIN teams t ON t.id = g.subject_id
         JOIN db_connections c ON c.id = g.connection_id
        WHERE g.subject_type = 'team'
        ORDER BY LOWER(c.name), LOWER(t.name)`,
    )
    .all(userId)) as InheritedDbAccess[];
  return { grants, inherited };
}

/** A team's grants. */
export async function getTeamDbAccess(teamId: string): Promise<DbAccessGrant[]> {
  return (await db
    .prepare(
      `SELECT c.id AS "connectionId", c.name AS "connectionName", g.level AS level, NULL AS "sqlUsername"
         FROM db_access_grants g JOIN db_connections c ON c.id = g.connection_id
        WHERE g.subject_type = 'team' AND g.subject_id = ?
        ORDER BY LOWER(c.name)`,
    )
    .all(teamId)) as DbAccessGrant[];
}

/** The database account name an administrator associated with this user on this connection. */
export async function getAccountHint(connectionId: string, userId: string): Promise<string | null> {
  const row = (await db
    .prepare("SELECT username FROM db_account_hints WHERE connection_id = ? AND user_id = ?")
    .get(connectionId, userId)) as { username: string } | undefined;
  return row?.username ?? null;
}

const replaceUserGrantsTx = async (userId: string, entries: DbAccessGrantInput[], by: string | null) =>
  await db.transaction(async () => {
    await db.prepare("DELETE FROM db_access_grants WHERE subject_type = 'user' AND subject_id = ?").run(userId);
    await db.prepare("DELETE FROM db_account_hints WHERE user_id = ?").run(userId);
    await addUserGrants(userId, entries, by);
  });

async function addUserGrants(userId: string, entries: DbAccessGrantInput[], by: string | null): Promise<void> {
  const grant = db.prepare(
    `INSERT INTO db_access_grants (connection_id, subject_type, subject_id, level, granted_by)
     VALUES (?, 'user', ?, ?, ?)
     ON CONFLICT(connection_id, subject_type, subject_id) DO UPDATE SET level = excluded.level, granted_by = excluded.granted_by`,
  );
  const hint = db.prepare(
    `INSERT INTO db_account_hints (connection_id, user_id, username, set_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(connection_id, user_id) DO UPDATE SET username = excluded.username, set_by = excluded.set_by,
       updated_at = utc_now()`,
  );
  for (const entry of entries) {
    if (entry.level) await grant.run(entry.connectionId, userId, entry.level, by);
    if (entry.sqlUsername) await hint.run(entry.connectionId, userId, entry.sqlUsername, by);
  }
}

/** Replaces everything granted to this user directly (their teams' grants are untouched). */
export async function replaceUserGrants(
  userId: string,
  entries: DbAccessGrantInput[],
  by: string | null,
): Promise<void> {
  await replaceUserGrantsTx(userId, entries, by);
}

/** Adds to what this user holds — an accepted invitation, applied inside its own transaction. */
export async function addUserGrantsInTransaction(
  userId: string,
  entries: DbAccessGrantInput[],
  by: string | null,
): Promise<void> {
  await addUserGrants(userId, entries, by);
}

const replaceTeamGrantsTx = async (teamId: string, entries: DbAccessGrantInput[], by: string | null) =>
  await db.transaction(async () => {
    await db.prepare("DELETE FROM db_access_grants WHERE subject_type = 'team' AND subject_id = ?").run(teamId);
    const grant = db.prepare(
      `INSERT INTO db_access_grants (connection_id, subject_type, subject_id, level, granted_by) VALUES (?, 'team', ?, ?, ?)`,
    );
    for (const entry of entries) if (entry.level) await grant.run(entry.connectionId, teamId, entry.level, by);
  });

/** Replaces every grant of this team. */
export async function replaceTeamGrants(
  teamId: string,
  entries: DbAccessGrantInput[],
  by: string | null,
): Promise<void> {
  await replaceTeamGrantsTx(teamId, entries, by);
}
