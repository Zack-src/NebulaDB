import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import SftpClient from "ssh2-sftp-client";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("remote-backups");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");

/** The first column of the first row, like SQLite's `pluck`. */
async function scalar(sql: string, ...params: unknown[]): Promise<unknown> {
  const row = (await db.prepare(sql).get(...params)) as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
}
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { backupStore } = await import("./storage.js");
const { failInterruptedBackups, insertBackup, purgeExpiredBackups } = await import("./repository.js");
const { insertRemoteDestination, loadRemoteDestination } = await import("./destinations.js");
const { MINIO, REMOTE_HINT, SFTP, WRONG_FINGERPRINT, minioReachable, sftpHostKey } =
  await import("./stores/testRemotes.js");

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App): Promise<string> {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)")
    .run(randomUUID(), email, await hashPassword(password));
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

function call(app: App, cookie: string, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const SHOP = `
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  INSERT INTO customers (id, name) VALUES (1, 'Ada Lovelace'), (2, 'Grace Hopper');
`;

function shopFile(extraRows = 0): string {
  const file = join(tmpdir(), `nebuladb-test-remote-backups-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(SHOP);
  const insert = target.prepare("INSERT INTO customers (name) VALUES (?)");
  target.transaction(() => {
    for (let i = 0; i < extraRows; i++) insert.run("filler");
  })();
  target.close();
  return file;
}

async function connect(app: App, cookie: string, name: string, filePath: string): Promise<string> {
  const res = await call(app, cookie, "POST", "/api/admin/connections", { name, engine: "sqlite", filePath });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection.id as string;
}

interface Backup {
  id: string;
  status: string;
  error: string | null;
  checksum: string | null;
  storage: { kind: string; location: string };
}

/** Read from the database rather than the list route, which is rate limited. */
async function waitForEnd(_app: App, _cookie: string, connId: string, id: string): Promise<Backup> {
  for (let i = 0; i < 2000; i++) {
    const status = (await scalar("SELECT status FROM backups WHERE id = ?", id)) as string;
    if (status !== "running") {
      const { backups } = (await call(_app, _cookie, "GET", `/api/admin/connections/${connId}/backups`)).json() as {
        backups: Backup[];
      };
      return backups.find((b) => b.id === id)!;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the backup never finished");
}

async function backUp(app: App, cookie: string, connId: string): Promise<Backup> {
  const started = await call(app, cookie, "POST", `/api/admin/connections/${connId}/backups`, {});
  assert.equal(started.statusCode, 202, started.body);
  return waitForEnd(app, cookie, connId, (started.json().backup as Backup).id);
}

const SECRET_KEY = "AKIA-never-leaves-the-server";
const SECRET_PASSWORD = "sftp-password-never-leaves";

test("a remote destination is checked before it is kept: bad input, the metadata endpoint, unreachable hosts", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app);
    const connId = await connect(app, admin, "Shop", shopFile());
    const url = `/api/admin/connections/${connId}/backup-destination`;
    const put = (body: unknown) => call(app, admin, "PUT", url, body);
    const s3 = { endpoint: "http://127.0.0.1:1", region: "us-east-1", bucket: "bucket-one", prefix: "x" };
    const keys = { accessKeyId: "AKIAEXAMPLE", secretAccessKey: SECRET_KEY };
    const sftp = {
      host: "127.0.0.1",
      port: 1,
      username: "nebula",
      remoteDir: "/upload",
      hostKeyFingerprint: WRONG_FINGERPRINT,
      password: SECRET_PASSWORD,
    };

    // Shapes that are refused outright.
    for (const body of [
      { kind: "ftp" },
      { kind: "s3", s3: { ...s3, ...keys, bucket: "No Good" } },
      { kind: "s3", s3: { ...s3, ...keys, endpoint: "ftp://host" } },
      { kind: "s3", s3: { ...s3, ...keys, endpoint: "http://user:pass@host" } },
      { kind: "s3", s3: { ...s3, accessKeyId: "AKIAEXAMPLE" } },
      { kind: "s3", s3: { ...s3, ...keys, prefix: "../up" } },
      { kind: "sftp", sftp: { ...sftp, hostKeyFingerprint: "" } },
      { kind: "sftp", sftp: { ...sftp, hostKeyFingerprint: "MD5:aa:bb" } },
      { kind: "sftp", sftp: { ...sftp, port: 70000 } },
      { kind: "sftp", sftp: { ...sftp, password: undefined } },
      { kind: "sftp", sftp: { ...sftp, privateKey: "not a key" } },
    ]) {
      const res = await put(body);
      assert.equal(res.json().code, "BACKUP_DESTINATION_INVALID", JSON.stringify(body));
    }

    // The same outbound check as database connections: the cloud metadata endpoint, as a literal and by name.
    for (const body of [
      { kind: "s3", s3: { ...s3, ...keys, endpoint: "http://169.254.169.254" } },
      { kind: "s3", s3: { ...s3, ...keys, endpoint: "http://metadata.google.internal/" } },
      { kind: "sftp", sftp: { ...sftp, host: "169.254.169.254" } },
      { kind: "sftp", sftp: { ...sftp, host: "metadata.google.internal" } },
    ]) {
      const res = await put(body);
      assert.equal(res.json().code, "CONNECTION_TARGET_FORBIDDEN", res.body);
    }

    // Nothing listens there: refused with the network's own words, and nothing is kept.
    for (const body of [
      { kind: "s3", s3: { ...s3, ...keys } },
      { kind: "sftp", sftp },
    ]) {
      const res = await put(body);
      assert.equal(res.json().code, "BACKUP_DESTINATION_UNUSABLE", res.body);
      assert.match(String(res.json().reason), /ECONNREFUSED|connect/i);
      assert.ok(!res.body.includes(SECRET_KEY) && !res.body.includes(SECRET_PASSWORD), "credentials are not echoed");
    }
    assert.equal(await scalar("SELECT COUNT(*) AS n FROM backup_destinations"), 0);
    const kept = (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json().destination;
    assert.equal(kept.kind, "local");
    assert.equal(kept.hasCredentials, false);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("credentials stay encrypted at rest and are never returned; a connection takes its destination with it", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app);
    const connId = await connect(app, admin, "Shop", shopFile());
    const id = await insertRemoteDestination({
      kind: "s3",
      settings: {
        endpoint: "http://127.0.0.1:1",
        region: "us-east-1",
        bucket: "bucket-one",
        prefix: "nebula",
        pathStyle: true,
      },
      secret: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: SECRET_KEY },
    });
    const stored = (await db.prepare("SELECT * FROM backup_destinations WHERE id = ?").get(id)) as Record<
      string,
      string
    >;
    assert.ok(!JSON.stringify(stored).includes(SECRET_KEY) && !JSON.stringify(stored).includes("AKIAEXAMPLE"));
    assert.deepEqual((await loadRemoteDestination(id))?.secret, {
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: SECRET_KEY,
    });
    await db.prepare("UPDATE db_connections SET backup_destination_id = ? WHERE id = ?").run(id, connId);

    const listed = await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`);
    assert.ok(
      !listed.body.includes(SECRET_KEY) && !listed.body.includes("AKIAEXAMPLE"),
      "credentials are not returned",
    );
    const { destination } = listed.json();
    assert.deepEqual(
      { kind: destination.kind, bucket: destination.s3.bucket, hasCredentials: destination.hasCredentials },
      { kind: "s3", bucket: "bucket-one", hasCredentials: true },
    );
    assert.equal("secretAccessKey" in destination.s3 || "accessKeyId" in destination.s3, false);

    // Credentials left out are kept only for the same bucket and endpoint: they cannot be sent somewhere new.
    const retarget = await call(app, admin, "PUT", `/api/admin/connections/${connId}/backup-destination`, {
      kind: "s3",
      s3: { endpoint: "http://127.0.0.1:2", region: "us-east-1", bucket: "bucket-one", prefix: "", pathStyle: true },
    });
    assert.equal(retarget.json().code, "BACKUP_DESTINATION_INVALID");

    await call(app, admin, "DELETE", `/api/admin/connections/${connId}`);
    assert.equal(await scalar("SELECT COUNT(*) AS n FROM backup_destinations WHERE id = ?", id), 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a backup whose remote cannot be reached fails clearly, and is not forgotten", async () => {
  const app = await buildApp();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const admin = await login(app);
    const connId = await connect(app, admin, "Shop", shopFile());
    const backup = await backUp(app, admin, connId);
    assert.equal(backup.status, "done", backup.error ?? "");
    // Written to a folder, then pointed at a remote nothing answers on, as if the server had gone away.
    const dest = await insertRemoteDestination({
      kind: "s3",
      settings: {
        endpoint: "http://127.0.0.1:1",
        region: "us-east-1",
        bucket: "bucket-one",
        prefix: "",
        pathStyle: true,
      },
      secret: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: SECRET_KEY },
    });
    await db.prepare("UPDATE backups SET dir = NULL, destination_id = ? WHERE id = ?").run(dest, backup.id);

    const listed = (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json();
    assert.equal(listed.backups[0].storage.kind, "s3");
    assert.equal(listed.backups[0].storage.location, "s3://bucket-one/ (127.0.0.1:1)");

    const download = await call(app, admin, "GET", `/api/admin/backups/${backup.id}/download`);
    assert.equal(download.statusCode, 502, download.body);
    assert.equal(download.json().code, "BACKUP_STORAGE_UNREACHABLE");
    assert.match(String(download.json().reason), /ECONNREFUSED|connect/i);
    assert.ok(!download.body.includes(SECRET_KEY));

    const restore = await call(app, admin, "POST", `/api/admin/backups/${backup.id}/restore`, { confirmName: "Shop" });
    assert.equal(restore.json().code, "BACKUP_STORAGE_UNREACHABLE");

    // Deleting asks the remote: the record stays while the file cannot be removed.
    const removed = await call(app, admin, "DELETE", `/api/admin/backups/${backup.id}`);
    assert.equal(removed.json().code, "BACKUP_STORAGE_UNREACHABLE");
    await db.prepare("UPDATE backups SET started_at = utc_now('-400 days') WHERE id = ?").run(backup.id);
    assert.equal(await purgeExpiredBackups(), 0);
    assert.equal(await scalar("SELECT COUNT(*) AS n FROM backups WHERE id = ?", backup.id), 1);
  } finally {
    console.warn = warn;
    closeAllRooms();
    await app.close();
  }
});

interface Remote {
  kind: "s3" | "sftp";
  body: (good: boolean) => unknown;
  /** What `list` finds in the remote's folder. */
  list: () => Promise<string[]>;
  secrets: string[];
}

async function s3Remote(): Promise<Remote> {
  const bucket = `nebuladb-test-${randomUUID().slice(0, 8)}`;
  const client = new S3Client({
    region: "us-east-1",
    endpoint: MINIO.settings(bucket).endpoint,
    forcePathStyle: true,
    credentials: MINIO.secret,
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return {
    kind: "s3",
    secrets: [MINIO.secret.secretAccessKey],
    body: (good) => ({
      kind: "s3",
      s3: {
        ...MINIO.settings(bucket, "nebula/db"),
        accessKeyId: MINIO.secret.accessKeyId,
        secretAccessKey: good ? MINIO.secret.secretAccessKey : "not-the-secret-key",
      },
    }),
    list: async () =>
      ((await client.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents ?? []).map((o) => o.Key!),
  };
}

async function sftpRemote(fingerprint: string): Promise<Remote> {
  const remoteDir = `${SFTP.remoteDir}/${randomUUID().slice(0, 8)}`;
  return {
    kind: "sftp",
    secrets: [SFTP.secret.password],
    body: (good) => ({
      kind: "sftp",
      sftp: { ...SFTP.settings(good ? fingerprint : WRONG_FINGERPRINT, remoteDir), password: SFTP.secret.password },
    }),
    list: async () => {
      const client = new SftpClient();
      await client.connect({
        host: SFTP.host,
        port: SFTP.port,
        username: SFTP.username,
        password: SFTP.secret.password,
      });
      try {
        return (await client.list(remoteDir)).map((entry) => entry.name);
      } catch {
        return [];
      } finally {
        await client.end().catch(() => {});
      }
    },
  };
}

async function exercise(remote: Remote): Promise<void> {
  const app = await buildApp();
  const destinationsBefore = await scalar("SELECT COUNT(*) AS n FROM backup_destinations");
  try {
    const admin = await login(app);
    const file = shopFile();
    const connId = await connect(app, admin, "Shop", file);
    const url = `/api/admin/connections/${connId}/backup-destination`;
    const put = (body: unknown) => call(app, admin, "PUT", url, body);

    // Refused with the remote's own words; the keys the request carried are not echoed.
    const wrong = await put(remote.body(false));
    assert.equal(wrong.json().code, "BACKUP_DESTINATION_UNUSABLE", wrong.body);
    assert.ok(String(wrong.json().reason).length > 0);
    if (remote.kind === "sftp") assert.match(String(wrong.json().reason), /does not match/);
    assert.ok(remote.secrets.every((secret) => !wrong.body.includes(secret)));

    const saved = await put(remote.body(true));
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().destination.kind, remote.kind);
    assert.equal(saved.json().destination.hasCredentials, true);
    assert.ok(remote.secrets.every((secret) => !saved.body.includes(secret)));
    assert.deepEqual(await remote.list(), [], "the probe leaves nothing");

    // The first backup lives in the remote, encrypted; the file and the download agree.
    const first = await backUp(app, admin, connId);
    assert.equal(first.status, "done", first.error ?? "");
    assert.equal(first.storage.kind, remote.kind);
    assert.deepEqual(
      await remote.list(),
      [`${first.id}.bak`].map((name) => (remote.kind === "s3" ? `nebula/db/${name}` : name)),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of await (await backupStore(first.id)).read(`${first.id}.bak`)) chunks.push(chunk as Buffer);
    const stored = Buffer.concat(chunks);
    assert.equal(createHash("sha256").update(stored).digest("hex"), first.checksum);
    assert.ok(!stored.includes("Ada Lovelace") && !gunzipSyncSafe(stored), "the remote never sees plain data");
    const download = await call(app, admin, "GET", `/api/admin/backups/${first.id}/download`);
    assert.equal(download.statusCode, 200, download.body);
    assert.ok(gunzipSync(download.rawPayload).toString("utf8").includes("Ada Lovelace"));

    // Credentials left out are kept for the same place.
    const sameBody = JSON.parse(JSON.stringify(remote.body(true))) as Record<string, Record<string, unknown>>;
    for (const field of ["accessKeyId", "secretAccessKey", "password"]) delete sameBody[remote.kind][field];
    assert.equal((await put(sameBody)).statusCode, 200);
    assert.equal((await backUp(app, admin, connId)).status, "done");

    // Changing the destination to a folder leaves the remote backup readable.
    const share = join(mkdtempSync(join(tmpdir(), "nebuladb-share-")), "backups");
    assert.equal((await put({ directory: share })).json().destination.kind, "local");
    const local = await backUp(app, admin, connId);
    assert.equal(local.storage.kind, "local");
    assert.equal((await call(app, admin, "GET", `/api/admin/backups/${first.id}/download`)).statusCode, 200);
    // … including a restore from it.
    const target = new Database(file);
    target.exec("DELETE FROM customers");
    target.close();
    const restored = await call(app, admin, "POST", `/api/admin/backups/${first.id}/restore`, {
      confirmName: "Shop",
      skipSafetyBackup: true,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().result.success, true, restored.body);
    const after = new Database(file, { readonly: true });
    assert.equal(after.prepare("SELECT COUNT(*) AS n FROM customers").pluck().get(), 2);
    after.close();

    // A cancelled backup leaves no object behind.
    assert.equal((await put(remote.body(true))).statusCode, 200);
    const before = await remote.list();
    const big = new Database(file);
    const insert = big.prepare("INSERT INTO customers (name) VALUES (?)");
    big.transaction(() => {
      for (let i = 0; i < 60_000; i++) insert.run("filler");
    })();
    big.close();
    const started = await call(app, admin, "POST", `/api/admin/connections/${connId}/backups`, {});
    const runningId = (started.json().backup as Backup).id;
    assert.equal((await call(app, admin, "POST", `/api/admin/backups/${runningId}/cancel`)).statusCode, 200);
    const cancelled = await waitForEnd(app, admin, connId, runningId);
    assert.equal(cancelled.status, "cancelled");
    assert.deepEqual(await remote.list(), before);

    // A restart: the half-written object of a running backup is removed, and the backup marked failed.
    const interrupted = await insertBackup({
      connectionId: connId,
      connectionName: "Shop",
      engine: "sqlite",
      trigger: "manual",
      scope: null,
      note: null,
      createdBy: null,
    });
    await (await backupStore(interrupted)).write(`${interrupted}.bak`, Readable.from([Buffer.from("half")]));
    assert.equal((await remote.list()).length, before.length + 1);
    assert.equal(await failInterruptedBackups(), 1);
    assert.deepEqual(await remote.list(), before);
    assert.equal(await scalar("SELECT status FROM backups WHERE id = ?", interrupted), "failed");

    // Retention reaches the remote too.
    await db.prepare("UPDATE backups SET started_at = utc_now('-4000 days') WHERE id = ?").run(first.id);
    assert.equal(await purgeExpiredBackups(), 1);
    const afterPurge = await remote.list();
    assert.equal(afterPurge.length, before.length - 1);
    assert.ok(!afterPurge.some((name) => name.includes(first.id)));

    // So does a delete; and the connection's removal takes the rest, and the destination row.
    const viaRemote = await backUp(app, admin, connId);
    assert.equal(viaRemote.storage.kind, remote.kind);
    assert.equal((await remote.list()).length, afterPurge.length + 1);
    assert.equal((await call(app, admin, "DELETE", `/api/admin/backups/${viaRemote.id}`)).statusCode, 200);
    assert.deepEqual(await remote.list(), afterPurge);
    assert.equal((await backUp(app, admin, connId)).status, "done");
    await call(app, admin, "DELETE", `/api/admin/connections/${connId}`);
    for (let i = 0; i < 200 && (await remote.list()).length > 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(await remote.list(), []);
    assert.equal(await scalar("SELECT COUNT(*) AS n FROM backup_destinations"), destinationsBefore);
  } finally {
    closeAllRooms();
    await app.close();
  }
}

/** Whether the bytes gunzip: they must not, they are ciphertext. */
function gunzipSyncSafe(bytes: Buffer): boolean {
  try {
    gunzipSync(bytes);
    return true;
  } catch {
    return false;
  }
}

test("S3: a connection's backups go to the bucket and come back; cancel, restart, delete and retention clean it", async (t) => {
  if (!(await minioReachable())) {
    t.skip(`no MinIO test container reachable at ${MINIO.host}:${MINIO.port} (${REMOTE_HINT})`);
    return;
  }
  await exercise(await s3Remote());
});

test("SFTP: a connection's backups go to the server and come back; cancel, restart, delete and retention clean it", async (t) => {
  const fingerprint = await sftpHostKey();
  if (!fingerprint) {
    t.skip(`no SFTP test container reachable at ${SFTP.host}:${SFTP.port} (${REMOTE_HINT})`);
    return;
  }
  await exercise(await sftpRemote(fingerprint));
});
