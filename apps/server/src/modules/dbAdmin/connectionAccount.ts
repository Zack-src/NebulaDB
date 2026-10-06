import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { personalCredentialStatus } from "../connections/personalCredentials.js";

/**
 * The database accounts the console must not drop, lock or change the
 * password of from Nebula itself: the one stored on the connection (its
 * own login, or the service account in `personal` mode) and, in `personal`
 * mode, the caller's own account — the one this very request connects as.
 * Doing any of those from here would lock Nebula (or this person) out of
 * the database, with no way back from the console.
 */
export function protectedAccountNames(connection: DatabaseConnectionConfig, actorId: string | null): string[] {
  const names = new Set<string>();
  if (connection.user) names.add(connection.user);
  const fromString = accountInConnectionString(connection.connectionString);
  if (fromString) names.add(fromString);
  if (connection.authMode === "personal" && actorId) {
    const own = personalCredentialStatus(connection, actorId).username;
    if (own) names.add(own);
  }
  return [...names];
}

/**
 * Compared without case: engines disagree on whether account names are
 * case-sensitive, and refusing one action too many is the safe side here.
 * A MySQL account is compared by name whatever its host.
 */
export function isConnectionAccount(
  connection: DatabaseConnectionConfig,
  principalName: string,
  actorId: string | null,
): boolean {
  const wanted = principalName.trim().toLowerCase();
  return protectedAccountNames(connection, actorId).some((name) => name.trim().toLowerCase() === wanted);
}

/** `postgres://user:…@host/db`, `mysql://…`, or an ADO-style `User Id=…;` string. */
export function accountInConnectionString(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(connectionString)) {
    try {
      const user = decodeURIComponent(new URL(connectionString).username);
      return user || null;
    } catch {
      return null;
    }
  }
  const match = /(?:^|;)\s*(?:user\s*id|uid|user|username)\s*=\s*([^;]+)/i.exec(connectionString);
  return match?.[1]?.trim() || null;
}
