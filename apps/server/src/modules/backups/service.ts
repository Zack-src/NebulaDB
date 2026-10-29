import path from "node:path";
import type { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { BackupDestination, BackupList, BackupSummary, DatabaseConnectionConfig } from "@nebuladb/shared";
import { config } from "../../config.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { connectionOwner, getConnectionById } from "../connections/repository.js";
import {
  connectionDestinationId,
  insertRemoteDestination,
  loadRemoteDestination,
  loadRemoteSettings,
  pruneUnusedDestinations,
  setConnectionDestinationId,
} from "./destinations.js";
import {
  deleteBackup,
  getBackup,
  getBackupDirectory,
  getBackupKey,
  listBackups,
  setBackupDirectory,
  usedBytes,
} from "./repository.js";
import { cancelBackup, startBackup } from "./runner.js";
import { getBackupSchedule } from "./schedule.js";
import { backupFileChecksum, openBackupDownload } from "./storage.js";
import { LocalStore, openRemoteStore, remoteLabel, storeReason, type RemoteDestination } from "./stores/index.js";
import { normalizePrefix } from "./stores/s3.js";
import { normalizeFingerprint } from "./stores/sftp.js";

/**
 * What can be done with a database's backups, once — the app's routes and
 * `/api/v1` both come here, so the two cannot disagree on a rule. Who may do
 * it (instance administrators) is the routes' to check.
 */

type Actor = { id: string; email: string; displayName: string };

const MAX_TABLES = 2000;
const MAX_NOTE = 500;
const MAX_DIRECTORY = 1024;

async function destinationOf(connectionId: string): Promise<BackupDestination> {
  const id = await connectionDestinationId(connectionId);
  const remote = id ? await loadRemoteSettings(id) : null;
  return {
    kind: remote?.kind ?? "local",
    directory: await getBackupDirectory(connectionId),
    defaultDirectory: path.resolve(config.databaseBackupDir),
    s3: remote?.kind === "s3" ? remote.settings : null,
    sftp: remote?.kind === "sftp" ? { ...remote.settings, authMethod: await remoteAuthMethod(id!) } : null,
    hasCredentials: remote !== null,
  };
}

/** Which credential an SFTP destination holds, without handing it out. */
async function remoteAuthMethod(destinationId: string): Promise<"password" | "privateKey"> {
  try {
    const remote = await loadRemoteDestination(destinationId);
    return remote?.kind === "sftp" && remote.secret.privateKey ? "privateKey" : "password";
  } catch {
    return "password";
  }
}

const invalid = () => new ApiError("BACKUP_DESTINATION_INVALID");

/** A string field of at most `max` characters without NUL; `fallback` when absent or empty. */
function text(value: unknown, max: number, fallback?: string): string {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw invalid();
  }
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw invalid();
  return value.trim();
}

/** A credential that may be left out (kept as saved): absent, empty, or a bounded string. */
function optionalSecret(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw invalid();
  return value;
}

type SavedRemote = RemoteDestination | null;

function parseS3(body: Record<string, unknown>, saved: SavedRemote): RemoteDestination {
  const input = (body.s3 ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw invalid();
  let endpoint = text(input.endpoint, 512, "");
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw invalid();
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw invalid();
    endpoint = url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, ""));
  }
  const bucket = text(input.bucket, 63);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw invalid();
  const prefix = normalizePrefix(text(input.prefix, 512, ""));
  if (prefix.split("/").includes("..")) throw invalid();
  const settings = {
    endpoint,
    region: text(input.region, 64, "us-east-1"),
    bucket,
    prefix: prefix.replace(/\/$/, ""),
    pathStyle: input.pathStyle === true,
  };
  const same = saved?.kind === "s3" && saved.settings.endpoint === endpoint && saved.settings.bucket === bucket;
  const accessKeyId = optionalSecret(input.accessKeyId, 256) ?? (same ? saved.secret.accessKeyId : undefined);
  const secretAccessKey =
    optionalSecret(input.secretAccessKey, 256) ?? (same ? saved.secret.secretAccessKey : undefined);
  if (!accessKeyId || !secretAccessKey) throw invalid();
  return { kind: "s3", settings, secret: { accessKeyId, secretAccessKey } };
}

function parseSftp(body: Record<string, unknown>, saved: SavedRemote): RemoteDestination {
  const input = (body.sftp ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw invalid();
  const host = text(input.host, 255);
  if (/\s/.test(host)) throw invalid();
  const port = input.port === undefined || input.port === "" ? 22 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
  const fingerprint =
    typeof input.hostKeyFingerprint === "string" ? normalizeFingerprint(input.hostKeyFingerprint) : null;
  if (!fingerprint) throw invalid();
  const settings = {
    host,
    port,
    username: text(input.username, 128),
    remoteDir: path.posix.normalize(text(input.remoteDir, MAX_DIRECTORY, "/")),
    hostKeyFingerprint: fingerprint,
  };
  const password = optionalSecret(input.password, 1024);
  const privateKey = optionalSecret(input.privateKey, 16384);
  const passphrase = optionalSecret(input.passphrase, 1024);
  if (privateKey !== undefined && !privateKey.includes("PRIVATE KEY")) throw invalid();
  if (password !== undefined || privateKey !== undefined) {
    return { kind: "sftp", settings, secret: { password, privateKey, passphrase } };
  }
  const same =
    saved?.kind === "sftp" &&
    saved.settings.host === host &&
    saved.settings.port === port &&
    saved.settings.username === settings.username;
  if (!same) throw invalid();
  return { kind: "sftp", settings, secret: saved.secret };
}

/**
 * The remote a request describes. A credential left out is taken from the
 * connection's saved destination — but only while the place it opens is the
 * same (bucket and endpoint, or host, port and user): saved keys are never
 * sent somewhere new, so they cannot be redirected to a server of one's own.
 */
async function parseRemote(body: Record<string, unknown>, connectionId: string): Promise<RemoteDestination> {
  const savedId = await connectionDestinationId(connectionId);
  const saved = savedId ? await loadRemoteDestination(savedId) : null;
  return body.kind === "s3" ? parseS3(body, saved) : parseSftp(body, saved);
}

/**
 * Where a connection's next backups are written: a folder of the server —
 * local, or a network share mounted there (or a `\\server\share` path on
 * Windows) — or `null` for the instance's own; or an S3-compatible bucket, or
 * an SFTP server. Tried before it is kept: a destination nothing can be written
 * to is refused with its own reason (the system's, or the remote's). A remote's
 * host goes through the same outbound check as database connections, and an
 * SFTP server whose host key is not the fingerprint given is refused. The
 * backups already taken stay where they are, and stay readable.
 */
export async function saveBackupDestination(user: Actor, connectionId: string, rawBody: unknown, req: FastifyRequest) {
  const connection = await requireConnection(connectionId);
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (typeof body !== "object" || Array.isArray(body)) throw invalid();
  const kind = body.kind ?? "local";
  if (kind !== "local" && kind !== "s3" && kind !== "sftp") throw invalid();

  let described: string;
  if (kind === "local") {
    const raw = body.directory;
    let directory: string | null = null;
    if (raw !== null && raw !== undefined && raw !== "") {
      if (typeof raw !== "string" || raw.length > MAX_DIRECTORY || raw.includes("\0") || !path.isAbsolute(raw.trim())) {
        throw invalid();
      }
      directory = path.normalize(raw.trim());
      await tryDestination(() => new LocalStore(directory!).probe());
    }
    if (
      directory !== (await getBackupDirectory(connectionId)) ||
      (await connectionDestinationId(connectionId)) !== null
    ) {
      await setBackupDirectory(connectionId, directory);
      await setConnectionDestinationId(connectionId, null);
    }
    described = directory ?? "instance default";
  } else {
    const remote = await parseRemote(body, connectionId);
    await tryDestination(() => openRemoteStore(remote).probe());
    const savedId = await connectionDestinationId(connectionId);
    const saved = savedId ? await loadRemoteDestination(savedId) : null;
    const unchanged = saved && JSON.stringify(saved) === JSON.stringify(remote);
    if (!unchanged) {
      await setConnectionDestinationId(connectionId, await insertRemoteDestination(remote));
      await setBackupDirectory(connectionId, null);
    }
    described = remoteLabel(remote);
  }
  await pruneUnusedDestinations();
  await auditUser(
    user,
    "backup.destination",
    { type: "connection", id: connectionId },
    `${connection.name}: ${described}`,
    req,
  );
  return await destinationOf(connectionId);
}

/** Runs the write test; its failure is reported with the reason the system or the remote gave. A refused host stays what it is. */
async function tryDestination(probe: () => Promise<void>): Promise<void> {
  try {
    await probe();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("BACKUP_DESTINATION_UNUSABLE", { details: { reason: storeReason(err) } });
  }
}

export async function requireConnection(id: string): Promise<DatabaseConnectionConfig> {
  const connection = await getConnectionById(id);
  if (!connection || (await connectionOwner(id))) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

export async function requireBackup(id: string): Promise<BackupSummary> {
  const backup = await getBackup(id);
  if (!backup) throw new ApiError("BACKUP_NOT_FOUND");
  return backup;
}

/** A list of table names, or nothing: the only shape a client may send for "which tables". */
export function parseTables(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_TABLES ||
    !value.every((name) => typeof name === "string" && name.length > 0 && name.length <= 128)
  ) {
    throw new ApiError("BACKUP_INVALID");
  }
  return value.length > 0 ? [...new Set(value as string[])] : undefined;
}

/** How a backup reads in the audit log. */
export const describeBackup = (backup: BackupSummary) =>
  `${backup.connectionName}, ${backup.scope ? `${backup.scope.length} table(s)` : "whole database"}, ${backup.startedAt}`;

export async function connectionBackups(connectionId: string): Promise<BackupList> {
  await requireConnection(connectionId);
  return {
    backups: await listBackups(connectionId),
    limits: { maxBytes: config.databaseBackupMaxBytes, retentionDays: config.databaseBackupRetentionDays },
    usedBytes: await usedBytes(connectionId),
    schedule: await getBackupSchedule(connectionId),
    destination: await destinationOf(connectionId),
  };
}

/** Returns as soon as the backup has started; its record says how far it is. */
export async function startManualBackup(
  user: Actor,
  connectionId: string,
  rawBody: unknown,
  req: FastifyRequest,
): Promise<BackupSummary> {
  const connection = await requireConnection(connectionId);
  const body = (rawBody ?? {}) as { tables?: unknown; note?: unknown };
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > MAX_NOTE)) {
    throw new ApiError("BACKUP_INVALID");
  }
  const { backup } = await startBackup({
    connection,
    trigger: "manual",
    tables: parseTables(body.tables),
    note: (body.note as string | undefined)?.trim() || null,
    createdBy: user,
  });
  await auditUser(user, "backup.create", { type: "connection", id: connectionId }, describeBackup(backup), req);
  return backup;
}

export async function cancelRunningBackup(backupId: string): Promise<void> {
  const backup = await requireBackup(backupId);
  if (backup.status !== "running" || !cancelBackup(backupId)) throw new ApiError("BACKUP_NOT_READY");
}

export async function removeBackup(user: Actor, backupId: string, req: FastifyRequest): Promise<void> {
  const backup = await requireBackup(backupId);
  // A running one is cancelled, not pulled from under the writer.
  if (backup.status === "running") throw new ApiError("BACKUP_NOT_READY");
  await deleteBackup(backupId);
  await auditUser(
    user,
    "backup.delete",
    { type: "connection", id: backup.connectionId ?? "" },
    describeBackup(backup),
    req,
  );
}

/** The decrypted file, still gzipped: one JSON document per line (see `BackupFileHeader`). */
export async function downloadBackup(
  user: Actor,
  backupId: string,
  req: FastifyRequest,
): Promise<{ fileName: string; stream: Readable }> {
  const backup = await requireBackup(backupId);
  const key = await getBackupKey(backupId);
  if (backup.status !== "done" || !key) throw new ApiError("BACKUP_NOT_READY");
  if ((await backupFileChecksum(backupId)) !== backup.checksum) throw new ApiError("BACKUP_CORRUPTED");
  await auditUser(
    user,
    "backup.download",
    { type: "connection", id: backup.connectionId ?? "" },
    describeBackup(backup),
    req,
  );
  const name = `${backup.connectionName.replace(/[^A-Za-z0-9._-]+/g, "_") || "backup"}-${backup.startedAt.replace(/[^0-9]/g, "")}`;
  return { fileName: `${name}.jsonl.gz`, stream: await openBackupDownload(backupId, key) };
}
