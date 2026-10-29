import crypto from "node:crypto";
import type { S3DestinationSettings, SftpDestinationSettings } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { remoteLabel, type RemoteDestination } from "./stores/index.js";

/**
 * Remote destinations (S3, SFTP) a connection's backups go to. A saved
 * destination is never edited: changing one writes a new row, and a backup
 * keeps the id of the row it was written to — so changing a connection's
 * destination later leaves the older backups readable, with their own
 * credentials. A row that no connection and no backup points to is removed.
 * The credentials are encrypted with the instance secret
 * (`secret_encrypted`, re-encrypted by `rotate-secret`) and never leave it.
 */

interface DestinationRow {
  id: string;
  kind: "s3" | "sftp";
  settings_json: string;
  label: string;
  secret_encrypted: string;
}

function rowToRemote(row: DestinationRow): RemoteDestination {
  const secret = decryptPayload(row.secret_encrypted);
  return row.kind === "s3"
    ? { kind: "s3", settings: JSON.parse(row.settings_json) as S3DestinationSettings, secret: secret as never }
    : { kind: "sftp", settings: JSON.parse(row.settings_json) as SftpDestinationSettings, secret: secret as never };
}

export async function insertRemoteDestination(remote: RemoteDestination): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO backup_destinations (id, kind, settings_json, label, secret_encrypted) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, remote.kind, JSON.stringify(remote.settings), remoteLabel(remote), encryptPayload(remote.secret));
  return id;
}

/** The destination with its credentials decrypted; `null` when there is no such row. */
export async function loadRemoteDestination(id: string): Promise<RemoteDestination | null> {
  const row = (await db.prepare("SELECT * FROM backup_destinations WHERE id = ?").get(id)) as
    DestinationRow | undefined;
  return row ? rowToRemote(row) : null;
}

/** A destination's kind and settings, without its credentials — what the API shows. `null` when there is no such row. */
export async function loadRemoteSettings(
  id: string,
): Promise<
  { kind: "s3"; settings: S3DestinationSettings } | { kind: "sftp"; settings: SftpDestinationSettings } | null
> {
  const row = (await db.prepare("SELECT kind, settings_json FROM backup_destinations WHERE id = ?").get(id)) as
    { kind: "s3" | "sftp"; settings_json: string } | undefined;
  if (!row) return null;
  return row.kind === "s3"
    ? { kind: "s3", settings: JSON.parse(row.settings_json) as S3DestinationSettings }
    : { kind: "sftp", settings: JSON.parse(row.settings_json) as SftpDestinationSettings };
}

/** The remote a connection's next backups go to; `null` when it uses a folder. */
export async function connectionDestinationId(connectionId: string): Promise<string | null> {
  const row = (await db.prepare("SELECT backup_destination_id FROM db_connections WHERE id = ?").get(connectionId)) as
    { backup_destination_id: string | null } | undefined;
  return row?.backup_destination_id ?? null;
}

export async function setConnectionDestinationId(connectionId: string, destinationId: string | null): Promise<void> {
  await db.prepare("UPDATE db_connections SET backup_destination_id = ? WHERE id = ?").run(destinationId, connectionId);
}

/** Where an existing backup was written: a folder (`dir`, `null` for the instance's own) or a saved remote. */
export async function backupPlacement(backupId: string): Promise<{ dir: string | null; destinationId: string | null }> {
  const row = (await db.prepare("SELECT dir, destination_id FROM backups WHERE id = ?").get(backupId)) as
    { dir: string | null; destination_id: string | null } | undefined;
  return { dir: row?.dir ?? null, destinationId: row?.destination_id ?? null };
}

/** Removes the destinations nothing refers to any more — their credentials go with them. */
export async function pruneUnusedDestinations(): Promise<void> {
  await db
    .prepare(
      `DELETE FROM backup_destinations
      WHERE id NOT IN (SELECT backup_destination_id FROM db_connections WHERE backup_destination_id IS NOT NULL)
        AND id NOT IN (SELECT destination_id FROM backups WHERE destination_id IS NOT NULL)`,
    )
    .run();
}

/** The kind and label of a saved destination, for the backups list. */
export const DESTINATION_COLUMNS =
  "(SELECT kind FROM backup_destinations d WHERE d.id = backups.destination_id) AS destination_kind, " +
  "(SELECT label FROM backup_destinations d WHERE d.id = backups.destination_id) AS destination_label";
