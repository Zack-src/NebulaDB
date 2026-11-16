import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { useTestDatabase } from "../../../infrastructure/testDatabase.js";

await useTestDatabase("backupstore");
process.env.NEBULADB_DATABASE_BACKUP_DIR = mkdtempSync(join(tmpdir(), "nebuladb-legacy-backups-"));
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";

const { db } = await import("../../../infrastructure/db.js");
const { DatabaseStore, CHUNK_BYTES } = await import("./database.js");
const { LocalStore, ObjectMissingError } = await import("./index.js");
const { moveBackupFilesToDatabase } = await import("../legacyFiles.js");

/** A backup row the chunks can belong to. */
async function backupRow(inDatabase = true, checksum: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO backups (id, connection_id, connection_name, engine, trigger, status, checksum, in_database)
       VALUES (?, 'c1', 'Shop', 'sqlite', 'manual', 'done', ?, ?)`,
    )
    .run(id, checksum, inDatabase);
  return id;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

const chunkCount = async (id: string) =>
  Number(
    ((await db.prepare("SELECT COUNT(*) AS n FROM backup_chunks WHERE backup_id = ?").get(id)) as { n: string }).n,
  );

test("a backup bigger than a chunk is stored in slices and read back whole, in order", async () => {
  const store = new DatabaseStore();
  const id = await backupRow();
  const bytes = crypto.randomBytes(CHUNK_BYTES * 2 + 12_345);
  // Arriving in small pieces, as a stream does.
  await store.write(
    `${id}.bak`,
    Readable.from(
      Array.from({ length: Math.ceil(bytes.length / 65_536) }, (_, i) => bytes.subarray(i * 65_536, (i + 1) * 65_536)),
    ),
  );
  assert.equal(await chunkCount(id), 3, "two full slices and the rest");
  assert.ok((await readAll(await store.read(`${id}.bak`))).equals(bytes));
});

test("writing over a name replaces it, a missing one is reported, deleting twice is not an error", async () => {
  const store = new DatabaseStore();
  const id = await backupRow();
  await store.write(`${id}.bak`, Readable.from([Buffer.from("first")]));
  await store.write(`${id}.bak`, Readable.from([Buffer.from("second")]));
  assert.equal((await readAll(await store.read(`${id}.bak`))).toString(), "second");
  await store.delete(`${id}.bak`);
  await store.delete(`${id}.bak`);
  await assert.rejects(store.read(`${id}.bak`), ObjectMissingError);
});

test("a transfer that fails half-way leaves nothing behind", async () => {
  const store = new DatabaseStore();
  const id = await backupRow();
  async function* broken(): AsyncGenerator<Buffer> {
    yield crypto.randomBytes(CHUNK_BYTES + 1);
    throw new Error("the source went away");
  }
  await assert.rejects(store.write(`${id}.bak`, Readable.from(broken())), /the source went away/);
  assert.equal(await chunkCount(id), 0);
});

test("the bytes go with their backup: deleting the record removes them", async () => {
  const store = new DatabaseStore();
  const id = await backupRow();
  await store.write(`${id}.bak`, Readable.from([Buffer.from("kept")]));
  assert.equal(await chunkCount(id), 1);
  await db.prepare("DELETE FROM backups WHERE id = ?").run(id);
  assert.equal(await chunkCount(id), 0);
});

test("a backup written as a file moves into the database; one that does not match its checksum stays", async () => {
  const folder = new LocalStore(process.env.NEBULADB_DATABASE_BACKUP_DIR!);
  const good = Buffer.from("an encrypted backup");
  const goodId = await backupRow(false, crypto.createHash("sha256").update(good).digest("hex"));
  await folder.write(`${goodId}.bak`, Readable.from([good]));
  const alteredId = await backupRow(false, crypto.createHash("sha256").update("what it was").digest("hex"));
  await folder.write(`${alteredId}.bak`, Readable.from([Buffer.from("what it became")]));
  const goneId = await backupRow(false, crypto.createHash("sha256").update("x").digest("hex"));

  const lines: string[] = [];
  assert.equal(await moveBackupFilesToDatabase((line) => lines.push(line)), 1);

  assert.equal(
    ((await db.prepare("SELECT in_database FROM backups WHERE id = ?").get(goodId)) as { in_database: boolean })
      .in_database,
    true,
  );
  assert.equal((await readAll(await new DatabaseStore().read(`${goodId}.bak`))).toString(), "an encrypted backup");
  await assert.rejects(folder.read(`${goodId}.bak`), ObjectMissingError, "the file is gone once it is in the database");

  assert.equal(
    ((await db.prepare("SELECT in_database FROM backups WHERE id = ?").get(alteredId)) as { in_database: boolean })
      .in_database,
    false,
  );
  assert.equal(await chunkCount(alteredId), 0);
  assert.equal(
    (await readAll(await folder.read(`${alteredId}.bak`))).toString(),
    "what it became",
    "left where it was",
  );
  assert.ok(lines.some((line) => line.includes(alteredId)));
  assert.equal(
    ((await db.prepare("SELECT in_database FROM backups WHERE id = ?").get(goneId)) as { in_database: boolean })
      .in_database,
    false,
  );

  assert.equal(await moveBackupFilesToDatabase(), 0, "nothing left to move that can be");
});
