import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountChange, AccountWatchState, DatabaseConnectionConfig } from "@nebuladb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { db } from "../../infrastructure/db.js";
import { audit } from "../../shared/audit.js";
import { getConnectionById, getProjectConnection } from "../connections/repository.js";
import { createAdminDriver } from "../dbAdmin/drivers/index.js";
import { notifyFollowers } from "../notifications/repository.js";
import { emitWebhookEvent } from "../webhooks/dispatcher.js";
import {
  applyAccountDelta,
  describeAccountChange,
  diffAccountLines,
  hashAccountLines,
  summarizeAccountChanges,
} from "./accountFingerprint.js";
import { readAccountLines } from "./accountReader.js";
import { alreadyReported, insertDriftEvent } from "./repository.js";

/**
 * The accounts watch: a database's accounts, role memberships and privileges,
 * compared with the reference Nebula agreed with. A change made through the
 * console's "Utilisateurs" tab moves the reference along (see
 * `registerAccountWatchHooks`); any other difference is an alert — an
 * `accounts` finding, a notification to the project's followers and
 * `drift.detected` to its webhooks.
 *
 * Off for every project until an instance administrator turns it on, and
 * only read while the project's watch itself is on. Read as the connection's
 * service account, through the administration driver's listing calls, under
 * the connection budget.
 */

const READ_TIMEOUT_MS = 60_000;
const SYSTEM = { id: null, email: null };

export function engineHasAccounts(engine: string): boolean {
  return engine !== "sqlite";
}

type AccountReader = (connection: DatabaseConnectionConfig) => Promise<string[]>;

async function readWithAdminDriver(connection: DatabaseConnectionConfig): Promise<string[]> {
  const driver = await createAdminDriver(connection, "admin");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      readAccountLines(driver, connection.database || undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await driver.close().catch(() => {});
  }
}

let reader: AccountReader = readWithAdminDriver;

/** Tests: read accounts from somewhere else than a real server; `null` puts the real reader back. */
export function setAccountReaderForTests(fake: AccountReader | null): void {
  reader = fake ?? readWithAdminDriver;
}

/** Always as nobody: the service account reads, whoever triggered it. */
function readAccounts(connection: DatabaseConnectionConfig): Promise<string[]> {
  return asUnattended(() => reader(connection));
}

// ---- Storage -------------------------------------------------------------------

interface BaselineRow {
  hash: string;
  lines_json: string;
  taken_at: string;
  live_hash: string | null;
  last_error: string | null;
}

interface Baseline {
  hash: string;
  lines: string[];
  takenAt: string;
  liveHash: string | null;
  lastError: string | null;
}

function getBaseline(projectId: string, connectionId: string): Baseline | null {
  const row = db
    .prepare(
      "SELECT hash, lines_json, taken_at, live_hash, last_error FROM account_baselines WHERE project_id = ? AND connection_id = ?",
    )
    .get(projectId, connectionId) as BaselineRow | undefined;
  if (!row) return null;
  return {
    hash: row.hash,
    lines: JSON.parse(row.lines_json) as string[],
    takenAt: row.taken_at,
    liveHash: row.live_hash,
    lastError: row.last_error,
  };
}

function saveBaseline(projectId: string, connectionId: string, lines: string[]): void {
  db.prepare(
    `INSERT INTO account_baselines (project_id, connection_id, hash, lines_json, taken_at, last_read_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(project_id, connection_id) DO UPDATE SET
       hash = excluded.hash, lines_json = excluded.lines_json, taken_at = excluded.taken_at,
       live_hash = NULL, live_json = NULL, last_read_at = excluded.last_read_at, last_error = NULL`,
  ).run(projectId, connectionId, hashAccountLines(lines), JSON.stringify(lines));
}

function recordLive(projectId: string, connectionId: string, lines: string[] | null): void {
  db.prepare(
    `UPDATE account_baselines SET live_hash = ?, live_json = ?, last_read_at = datetime('now'), last_error = NULL
      WHERE project_id = ? AND connection_id = ?`,
  ).run(lines ? hashAccountLines(lines) : null, lines ? JSON.stringify(lines) : null, projectId, connectionId);
}

function recordReadError(projectId: string, connectionId: string, error: string): void {
  db.prepare(
    `INSERT INTO account_baselines (project_id, connection_id, hash, lines_json, last_read_at, last_error)
     VALUES (?, ?, '', '[]', datetime('now'), ?)
     ON CONFLICT(project_id, connection_id) DO UPDATE SET last_read_at = excluded.last_read_at, last_error = excluded.last_error`,
  ).run(projectId, connectionId, error.slice(0, 500));
}

function closeAccountEvents(projectId: string, connectionId: string): number {
  return db
    .prepare(
      `UPDATE drift_events SET status = 'resolved', resolved_at = datetime('now')
        WHERE project_id = ? AND connection_id = ? AND kind = 'accounts' AND status = 'open'`,
    )
    .run(projectId, connectionId).changes;
}

export function isAccountWatchOn(projectId: string): boolean {
  const row = db.prepare("SELECT watch_accounts FROM monitor_settings WHERE project_id = ?").get(projectId) as
    { watch_accounts: number } | undefined;
  return row?.watch_accounts === 1;
}

export function setAccountWatch(projectId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO monitor_settings (project_id, watch_accounts) VALUES (?, ?)
     ON CONFLICT(project_id) DO UPDATE SET watch_accounts = excluded.watch_accounts`,
  ).run(projectId, enabled ? 1 : 0);
}

/** The project's linked databases that have accounts. */
function accountConnections(projectId: string): DatabaseConnectionConfig[] {
  const ids = (
    db.prepare("SELECT connection_id FROM project_connection_links WHERE project_id = ?").all(projectId) as {
      connection_id: string;
    }[]
  ).map((row) => row.connection_id);
  return ids
    .map((id) => getProjectConnection(projectId, id))
    .filter((conn): conn is DatabaseConnectionConfig => conn !== null && engineHasAccounts(conn.engine));
}

/** Projects whose accounts watch is live on this database: watch on, accounts on, project active. */
function projectsWatchingAccountsOf(connectionId: string): string[] {
  return (
    db
      .prepare(
        `SELECT m.project_id FROM monitor_settings m
           JOIN projects p ON p.id = m.project_id
           JOIN project_connection_links l ON l.project_id = m.project_id
          WHERE l.connection_id = ? AND m.enabled = 1 AND m.watch_accounts = 1 AND p.status = 'active'`,
      )
      .all(connectionId) as { project_id: string }[]
  ).map((row) => row.project_id);
}

export function accountWatchState(projectId: string, canManage: boolean): AccountWatchState {
  return {
    enabled: isAccountWatchOn(projectId),
    canManage,
    connections: accountConnections(projectId).map((conn) => {
      const baseline = getBaseline(projectId, conn.id);
      const hasReference = Boolean(baseline && baseline.hash);
      return {
        connectionId: conn.id,
        connectionName: conn.name,
        engine: conn.engine,
        referenceAt: hasReference ? baseline!.takenAt : null,
        lastError: baseline?.lastError ?? null,
        differs: Boolean(hasReference && baseline!.liveHash && baseline!.liveHash !== baseline!.hash),
      };
    }),
  };
}

// ---- Comparing -----------------------------------------------------------------

export type AccountCheckOutcome = "reference" | "same" | "changed" | "known";

/**
 * Compares what was just read with the project's reference. The first read
 * becomes the reference (nothing to compare with yet); a state already
 * reported is not reported again.
 */
export function compareAccounts(
  projectId: string,
  connection: DatabaseConnectionConfig,
  lines: string[],
): AccountCheckOutcome {
  const baseline = getBaseline(projectId, connection.id);
  if (!baseline || !baseline.hash) {
    saveBaseline(projectId, connection.id, lines);
    return "reference";
  }
  const liveHash = hashAccountLines(lines);
  if (liveHash === baseline.hash) {
    recordLive(projectId, connection.id, null);
    closeAccountEvents(projectId, connection.id);
    return "same";
  }
  recordLive(projectId, connection.id, lines);
  if (alreadyReported(projectId, connection.id, liveHash)) return "known";

  const { added, removed } = diffAccountLines(baseline.lines, lines);
  const changes = summarizeAccountChanges(added, removed);
  insertDriftEvent({
    projectId,
    connectionId: connection.id,
    kind: "accounts",
    liveHash,
    added,
    removed,
    details: changes,
  });
  reportAccountChanges(projectId, connection, changes);
  return "changed";
}

function reportAccountChanges(projectId: string, connection: DatabaseConnectionConfig, changes: AccountChange[]): void {
  audit(
    SYSTEM,
    "monitoring.accounts",
    { type: "connection", id: connection.id },
    changes.map(describeAccountChange).join("; "),
    undefined,
    { projectId },
  );
  // A pointer, without the accounts' names: the followers who are project
  // administrators learn that something changed; the names stay on the
  // instance administrators' screens.
  notifyFollowers(
    projectId,
    "drift",
    {
      kind: "accounts",
      connection: connection.name,
      environment: connection.environment ?? null,
      changes: changes.length,
    },
    { needs: "administrator" },
  );
  const counts: Record<string, number> = {};
  for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  emitWebhookEvent(projectId, "drift.detected", {
    kind: "accounts",
    connectionName: connection.name,
    environment: connection.environment ?? null,
    added: [],
    removed: [],
    changed: [],
    accountChanges: counts,
  });
}

/** One pass over a project's databases that have accounts. Never throws; a failed read is kept to be shown. */
export async function checkProjectAccounts(projectId: string): Promise<{ checked: number; changes: number }> {
  const result = { checked: 0, changes: 0 };
  for (const connection of accountConnections(projectId)) {
    try {
      const lines = await readAccounts(connection);
      result.checked++;
      if (compareAccounts(projectId, connection, lines) === "changed") result.changes++;
    } catch (err) {
      recordReadError(projectId, connection.id, err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}

/**
 * An instance administrator accepts what the database holds now as the new
 * reference: the open findings are closed. Uses the last state read — the
 * one the administrator saw — not a new read that could hold something else.
 */
export function acceptAccountState(projectId: string, connectionId: string): boolean {
  const row = db
    .prepare("SELECT live_json FROM account_baselines WHERE project_id = ? AND connection_id = ?")
    .get(projectId, connectionId) as { live_json: string | null } | undefined;
  if (!row?.live_json) return false;
  saveBaseline(projectId, connectionId, JSON.parse(row.live_json) as string[]);
  closeAccountEvents(projectId, connectionId);
  return true;
}

// ---- Changes made through Nebula -----------------------------------------------

/**
 * Before the console changes accounts: reads them, so that whatever differs
 * from the reference *before* Nebula acts is reported as what it is — a
 * change made elsewhere — and not folded into Nebula's own. `null` when no
 * project watches this database's accounts (nothing is read then).
 */
export async function beforeNebulaAccountChange(connectionId: string): Promise<string[] | null> {
  const projects = projectsWatchingAccountsOf(connectionId);
  const connection = getConnectionById(connectionId);
  if (projects.length === 0 || !connection || !engineHasAccounts(connection.engine)) return null;
  const lines = await readAccounts(connection);
  for (const projectId of projects) {
    const linked = getProjectConnection(projectId, connectionId);
    if (linked) compareAccounts(projectId, linked, lines);
  }
  return lines;
}

/**
 * After the console changed accounts: what changed between the two reads is
 * Nebula's doing, and moves each watching project's reference along. A
 * difference that was already there stays — still open, now compared with
 * the state just read.
 */
export async function afterNebulaAccountChange(connectionId: string, before: string[]): Promise<void> {
  const connection = getConnectionById(connectionId);
  if (!connection) return;
  const after = await readAccounts(connection);
  const afterHash = hashAccountLines(after);
  for (const projectId of projectsWatchingAccountsOf(connectionId)) {
    const baseline = getBaseline(projectId, connectionId);
    if (!baseline || !baseline.hash) {
      saveBaseline(projectId, connectionId, after);
      continue;
    }
    const reference = applyAccountDelta(baseline.lines, before, after);
    saveBaseline(projectId, connectionId, reference);
    if (hashAccountLines(reference) === afterHash) {
      closeAccountEvents(projectId, connectionId);
    } else {
      recordLive(projectId, connectionId, after);
      // The same outside change, now seen next to Nebula's: not a new one.
      db.prepare(
        `UPDATE drift_events SET live_hash = ?
          WHERE project_id = ? AND connection_id = ? AND kind = 'accounts' AND status = 'open'`,
      ).run(afterHash, projectId, connectionId);
    }
  }
}

const ACCOUNT_ROUTE = "/api/admin/connections/:id/users";

/**
 * Wraps the console's account route (in `dbAdmin/routes.ts`, left untouched):
 * an executed change by an instance administrator is read around, so the
 * reference follows it. Anything else — a preview, someone the route will
 * refuse — reads nothing. Never fails the request: a read that fails leaves
 * the reference where it was, and the next pass reports the change, which is
 * the safe side.
 */
export function registerAccountWatchHooks(app: FastifyInstance): void {
  const pending = new WeakMap<FastifyRequest, { connectionId: string; before: string[] }>();
  app.addHook("preHandler", async (req) => {
    if (req.method !== "POST" || req.routeOptions.url !== ACCOUNT_ROUTE) return;
    if (!req.user?.isAdmin || (req.body as { execute?: unknown } | null)?.execute !== true) return;
    const { id } = req.params as { id: string };
    try {
      const before = await beforeNebulaAccountChange(id);
      if (before) pending.set(req, { connectionId: id, before });
    } catch (err) {
      req.log.warn({ err }, "accounts watch: could not read the accounts before a change");
    }
  });
  app.addHook("onResponse", async (req) => {
    const entry = pending.get(req);
    if (!entry) return;
    pending.delete(req);
    try {
      await afterNebulaAccountChange(entry.connectionId, entry.before);
    } catch (err) {
      req.log.warn({ err }, "accounts watch: could not read the accounts after a change");
    }
  });
}
