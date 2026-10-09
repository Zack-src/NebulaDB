import type { FastifyRequest } from "fastify";
import {
  DB_ACCESS_LEVELS,
  type DatabaseConnectionConfig,
  type DbAccessGrantInput,
  type DbAccessLevel,
  type DbConsoleAccess,
  type InvitationGrants,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { requireUser } from "../../shared/guards.js";
import type { SessionUser } from "../auth/session.js";
import { connectionOwner, getConnectionById } from "../connections/repository.js";
import { effectiveDbAccess } from "./repository.js";
import { mapAsync, someAsync } from "../../shared/async.js";

const MAX_ENTRIES = 500;
const MAX_SQL_USERNAME = 128;

export interface DbConsoleUser {
  user: SessionUser;
  connection: DatabaseConnectionConfig;
  /** `admin`: an instance administrator, the console's full rights. Otherwise the level granted. */
  access: DbConsoleAccess;
}

/**
 * Who may use the explorer and SQL of a connection: instance administrators,
 * and members granted access to it (directly or through a team). Read from
 * the grants on every request, so a revocation applies to the next one.
 *
 * Anyone else is told the connection does not exist — the same answer as for
 * a connection that does not. A member's grant works from a browser session
 * only: an API key is refused, since nothing under `/api/v1` offers SQL and a
 * leaked key should not turn into a database client.
 */
export async function requireDbConsoleUser(req: FastifyRequest, connectionId: string): Promise<DbConsoleUser> {
  const user = requireUser(req);
  const owner = await connectionOwner(connectionId);
  if (owner) {
    if (req.apiKey || owner !== user.id) throw new ApiError("CONNECTION_NOT_FOUND");
    return { user, connection: (await getConnectionById(connectionId))!, access: "write" };
  }
  if (user.isAdmin) {
    const connection = await getConnectionById(connectionId);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    return { user, connection, access: "admin" };
  }
  const level = req.apiKey ? null : await effectiveDbAccess(user.id, connectionId);
  const connection = level ? await getConnectionById(connectionId) : null;
  if (!level || !connection) throw new ApiError("CONNECTION_NOT_FOUND");
  return { user, connection, access: level };
}

function invalid(message: string): ApiError {
  return new ApiError("DB_ACCESS_INVALID", { message });
}

function parseLevel(value: unknown): DbAccessLevel | null {
  if (value === null || value === undefined || value === "" || value === "none") return null;
  if (typeof value !== "string" || !DB_ACCESS_LEVELS.includes(value as DbAccessLevel)) {
    throw invalid("level must be read, write or null");
  }
  return value as DbAccessLevel;
}

function parseSqlUsername(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid("sqlUsername must be a string");
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  if (name.length > MAX_SQL_USERNAME || /[\u0000-\u001f\u007f]/.test(name)) throw invalid("sqlUsername is invalid");
  return name || null;
}

/**
 * A list of grants as sent by the admin console. Every connection must exist;
 * the same connection twice is refused rather than guessed at. `withAccounts`:
 * whether a database account name may come with each entry (users and
 * invitations — a team has no account).
 */
export async function parseGrantEntries(
  raw: unknown,
  withAccounts: boolean,
  withProvisioning = false,
): Promise<DbAccessGrantInput[]> {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) throw invalid("grants must be an array");
  const seen = new Set<string>();
  const entries: DbAccessGrantInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) throw invalid("each grant must be an object");
    const { connectionId, level, sqlUsername, createAccount } = item as Record<string, unknown>;
    if (
      typeof connectionId !== "string" ||
      !(await getConnectionById(connectionId)) ||
      (await connectionOwner(connectionId))
    ) {
      throw new ApiError("CONNECTION_NOT_FOUND");
    }
    if (seen.has(connectionId)) throw invalid("a connection is listed twice");
    seen.add(connectionId);
    const entry: DbAccessGrantInput = { connectionId, level: parseLevel(level) };
    if (withAccounts) entry.sqlUsername = parseSqlUsername(sqlUsername);
    else if (sqlUsername !== undefined && sqlUsername !== null) throw invalid("a team has no database account");
    if (createAccount === true) {
      if (!withProvisioning) throw invalid("an account can only be created from an invitation");
      const connection = await getConnectionById(connectionId);
      if (!entry.sqlUsername) throw invalid("creating an account needs its name");
      if (connection?.authMode !== "personal" || connection.readOnly) {
        throw invalid("accounts are created only on personal-account connections that are not read-only");
      }
      entry.createAccount = true;
    }
    // An entry that grants nothing and names no account is simply "nothing for this connection".
    if (entry.level || entry.sqlUsername) entries.push(entry);
  }
  return entries;
}

/** What an invitation may give: teams to join and database access. Both optional. */
export async function parseInvitationGrants(body: Record<string, unknown>): Promise<InvitationGrants> {
  const rawTeams = body.teamIds ?? [];
  if (!Array.isArray(rawTeams) || rawTeams.length > MAX_ENTRIES || rawTeams.some((id) => typeof id !== "string")) {
    throw invalid("teamIds must be an array of team ids");
  }
  const teamIds = [...new Set(rawTeams as string[])];
  const exists = db.prepare("SELECT 1 FROM teams WHERE id = ?");
  if (await someAsync(teamIds, async (id) => !(await exists.get(id)))) {
    throw new ApiError("NOT_FOUND", { message: "no such team" });
  }
  return { teamIds, databases: await parseGrantEntries(body.databases ?? [], true, true) };
}

/** One line for the audit trail: `Shop: write (as ada), Stats: read`. */
export async function describeGrants(entries: DbAccessGrantInput[]): Promise<string> {
  if (entries.length === 0) return "none";
  const lines = await mapAsync(entries, async (entry) => {
    const name = (await getConnectionById(entry.connectionId))?.name ?? entry.connectionId;
    const account = entry.sqlUsername ? ` (as ${entry.sqlUsername})` : "";
    return `${name}: ${entry.level ?? "no access"}${account}`;
  });
  return lines.join(", ");
}
