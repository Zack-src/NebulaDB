import crypto from "node:crypto";
import type { AccountChange, DbGrant, DbPrincipal } from "@nebuladb/shared";

/**
 * The accounts of a database as one canonical, comparable value: a sorted set
 * of lines, each saying one thing — an account exists, it is locked, it is a
 * member of a role, it holds a privilege on an object. Two reads of the same
 * state give the same lines whatever order the engine listed them in, so the
 * hash of the lines is the fingerprint and the difference between two sets
 * of lines is exactly what changed.
 *
 * Built from what the administration drivers already list (`listPrincipals`,
 * `listGrants`): names, flags and privileges. A password or its hash is never
 * read, so it can never end up here.
 *
 * Each line is a JSON array, so a name holding a space or a quote cannot be
 * mistaken for two fields:
 *   ["account", key]
 *   ["flag", key, "login" | "locked" | "superuser"]
 *   ["member", key, role]
 *   ["grant", key, scope, object, privilege, "" | "grantable" | "denied"]
 *   ["unread", count]           — principals whose grants were not read (over the cap)
 */

export interface AccountListing {
  /** The principal's identity in the lines: `name`, `name@host` (MySQL), `database/name` (SQL Server database user). */
  key: string;
  principal: DbPrincipal;
  /** `null` when the grants were not read (a built-in account, or over the cap). */
  grants: DbGrant[] | null;
}

export function principalKey(principal: DbPrincipal, database?: string): string {
  const name = principal.host !== undefined ? `${principal.name}@${principal.host}` : principal.name;
  return database ? `${database}/${name}` : name;
}

function objectOf(grant: DbGrant): string {
  return [grant.database, grant.schema, grant.table].filter((part) => part !== undefined && part !== "").join(".");
}

/** The canonical lines of a listing: sorted, without duplicates. */
export function canonicalAccountLines(listing: AccountListing[], unread = 0): string[] {
  const lines = new Set<string>();
  const add = (...fields: (string | number)[]) => lines.add(JSON.stringify(fields));
  for (const { key, principal, grants } of listing) {
    add("account", key);
    // Engines spell "cannot log in" differently (PostgreSQL: no LOGIN; MySQL:
    // locked, or a role); the flags say what an attacker would care about.
    if (principal.locked) add("flag", key, "locked");
    else if (principal.canLogin) add("flag", key, "login");
    if (principal.superuser) add("flag", key, "superuser");
    for (const role of principal.memberOf) add("member", key, role);
    for (const grant of grants ?? []) {
      const mode = grant.denied ? "denied" : grant.grantable ? "grantable" : "";
      for (const privilege of grant.privileges) {
        add("grant", key, grant.scope, objectOf(grant), privilege.trim().toUpperCase(), mode);
      }
    }
  }
  if (unread > 0) add("unread", unread);
  return [...lines].sort();
}

export function hashAccountLines(lines: readonly string[]): string {
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function diffAccountLines(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((line) => !was.has(line)), removed: before.filter((line) => !now.has(line)) };
}

/**
 * Moves a reference along with a change Nebula made itself: what Nebula's
 * action added (`after` − `before`) is added to the reference, what it took
 * away is taken away. A difference the reference already had with the
 * database — a change made elsewhere, not yet accepted — stays a difference.
 */
export function applyAccountDelta(
  reference: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] {
  const { added, removed } = diffAccountLines(before, after);
  const gone = new Set(removed);
  return [...new Set([...reference.filter((line) => !gone.has(line)), ...added])].sort();
}

/**
 * What a difference means, one entry per fact: an account created or dropped
 * (its own flags, memberships and grants are not repeated), a lock, a role, a
 * privilege granted or revoked.
 */
export function summarizeAccountChanges(added: readonly string[], removed: readonly string[]): AccountChange[] {
  const parse = (lines: readonly string[]) => lines.map((line) => JSON.parse(line) as string[]);
  const plus = parse(added);
  const minus = parse(removed);
  const created = new Set(plus.filter((l) => l[0] === "account").map((l) => l[1]));
  const dropped = new Set(minus.filter((l) => l[0] === "account").map((l) => l[1]));
  const changes: AccountChange[] = [];
  for (const key of created) changes.push({ type: "created", principal: key });
  for (const key of dropped) changes.push({ type: "dropped", principal: key });

  const flags = (lines: string[][], key: string) =>
    new Set(lines.filter((l) => l[0] === "flag" && l[1] === key).map((l) => l[2]));
  const flagged = new Set([...plus, ...minus].filter((l) => l[0] === "flag").map((l) => l[1]));
  for (const key of flagged) {
    if (created.has(key) || dropped.has(key)) continue;
    const on = flags(plus, key);
    const off = flags(minus, key);
    if (on.has("locked")) changes.push({ type: "locked", principal: key });
    else if (off.has("locked")) changes.push({ type: "unlocked", principal: key });
    else if (on.has("login")) changes.push({ type: "login-granted", principal: key });
    else if (off.has("login")) changes.push({ type: "login-removed", principal: key });
    if (on.has("superuser")) changes.push({ type: "superuser-granted", principal: key });
    if (off.has("superuser")) changes.push({ type: "superuser-removed", principal: key });
  }

  const own = (key: string) => created.has(key) || dropped.has(key);
  for (const [lines, granted] of [
    [plus, true],
    [minus, false],
  ] as const) {
    for (const line of lines) {
      if (line[0] === "member" && !own(line[1])) {
        changes.push({ type: granted ? "role-granted" : "role-revoked", principal: line[1], role: line[2] });
      } else if (line[0] === "grant" && !own(line[1])) {
        changes.push({
          type: granted ? "privilege-granted" : "privilege-revoked",
          principal: line[1],
          scope: line[2],
          object: line[3],
          privilege:
            line[5] === "denied" ? `DENY ${line[4]}` : line[5] === "grantable" ? `${line[4]} (WITH GRANT)` : line[4],
        });
      }
    }
  }
  return changes;
}

/** One line of English per change, for a chat webhook or the audit log. */
export function describeAccountChange(change: AccountChange): string {
  switch (change.type) {
    case "role-granted":
    case "role-revoked":
      return `${change.principal}: role ${change.role} ${change.type === "role-granted" ? "granted" : "revoked"}`;
    case "privilege-granted":
    case "privilege-revoked":
      return `${change.principal}: ${change.privilege} on ${change.scope}${change.object ? ` ${change.object}` : ""} ${
        change.type === "privilege-granted" ? "granted" : "revoked"
      }`;
    default:
      return `${change.principal}: ${change.type.replace("-", " ")}`;
  }
}
