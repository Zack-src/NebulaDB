import type { BackupStore, RemoteDestination } from "./types.js";
import { S3Store, normalizePrefix, s3Reason } from "./s3.js";
import { SftpStore, sftpReason } from "./sftp.js";

export { LocalStore } from "./local.js";
export { ObjectMissingError } from "./types.js";
export type { BackupStore, RemoteDestination, S3Secret, SftpSecret } from "./types.js";

export function openRemoteStore(remote: RemoteDestination): BackupStore {
  return remote.kind === "s3"
    ? new S3Store(remote.settings, remote.secret)
    : new SftpStore(remote.settings, remote.secret);
}

/** Where a remote is, for people: never a credential. */
export function remoteLabel(remote: RemoteDestination): string {
  if (remote.kind === "s3") {
    const { bucket, prefix, endpoint } = remote.settings;
    return `s3://${bucket}/${normalizePrefix(prefix)}${endpoint ? ` (${new URL(endpoint).host})` : ""}`;
  }
  const { username, host, port, remoteDir } = remote.settings;
  return `sftp://${username}@${host}${port === 22 ? "" : `:${port}`}${remoteDir.startsWith("/") ? "" : "/"}${remoteDir}`;
}

/** What a failed call to a store says, in the remote's own words. */
export function storeReason(err: unknown): string {
  if (err !== null && typeof err === "object" && "$metadata" in err) return s3Reason(err);
  return sftpReason(err);
}
