import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";
import { createThrowawayDatabase, useTestDatabase } from "./testDatabase.js";

process.env.NEBULADB_SECRET ??= "instance-archive-test-secret-0123456789";
const sourceUrl = await useTestDatabase("archive_src");

const { db } = await import("./db.js");
const { exportInstance, rawTypes, EPHEMERAL_TABLES, codeSchemaVersion } = await import("./instanceArchive.js");
const { encryptPayload, decryptPayload } = await import("../shared/crypto.js");

const dir = mkdtempSync(join(tmpdir(), "nebuladb-archive-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const execFileAsync = promisify(execFile);
const importScript = fileURLToPath(new URL("../import-instance.js", import.meta.url));

async function runImport(url: string, archive: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [importScript, archive], {
      env: { ...process.env, NEBULADB_DATABASE_URL: url },
    });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

async function query<T>(url: string, text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function exportTo(file: string): Promise<Awaited<ReturnType<typeof exportInstance>>> {
  const client = new pg.Client({ connectionString: sourceUrl, types: rawTypes() });
  await client.connect();
  try {
    return await exportInstance(client, file);
  } finally {
    await client.end();
  }
}

function rewriteArchive(from: string, to: string, change: (lines: string[]) => string[]): void {
  const lines = gunzipSync(readFileSync(from)).toString("utf-8").split("\n").filter(Boolean);
  writeFileSync(to, gzipSync(change(lines).join("\n") + "\n"));
}

const userId = randomUUID();
const projectId = randomUUID();
const connectionId = randomUUID();
const updates = [randomBytes(300), randomBytes(5000), Buffer.from([0, 1, 2, 255, 254])];
const connectionConfig = { host: "db.internal", password: "s3cr3t-never-in-clear" };
const encrypted = encryptPayload(connectionConfig);

// A few rows more than one keyset page (1000) so paging is exercised.
const BULK = 2300;

await db
  .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, ?)")
  .run(userId, "ada@example.com", "hash-ada", 'Ada "quoted" \\ é 日本');
await db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)").run(projectId, "Shop", userId);
for (const update of updates) {
  await db
    .prepare("INSERT INTO revisions (id, project_id, author, label, yjs_update) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), projectId, "ada", "line1\nline2", update);
}
await db.prepare("INSERT INTO snapshots (project_id, yjs_state) VALUES (?, ?)").run(projectId, updates[1]);
await db
  .prepare(
    "INSERT INTO db_connections (id, name, engine, config_encrypted, created_by) VALUES (?, ?, 'postgres', ?, ?)",
  )
  .run(connectionId, "Warehouse", encrypted, userId);
await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run("sess-1", userId, "2999-01-01");
await db.exec(
  `INSERT INTO revisions (id, project_id, author, yjs_update)
   SELECT 'bulk-' || g, '${projectId}', 'bot', decode(lpad(to_hex(g % 256), 2, '0'), 'hex') FROM generate_series(1, ${BULK}) g`,
);

const archive = join(dir, "instance.jsonl.gz");
const exported = await exportTo(archive);

async function tableCounts(url: string, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await query<{ n: string }>(url, `SELECT COUNT(*) AS n FROM "${t}"`))[0].n);
  return out;
}

test("the archive lists every application table, in dependency order, without the ephemeral ones", () => {
  const names = exported.tables.map((t) => t.name);
  assert.ok(names.includes("users") && names.includes("revisions") && names.includes("db_connections"));
  for (const t of EPHEMERAL_TABLES) assert.equal(names.includes(t), false, t);
  assert.equal(names.includes("schema_migrations"), false);
  assert.ok(names.indexOf("users") < names.indexOf("projects"));
  assert.ok(names.indexOf("projects") < names.indexOf("revisions"));
  assert.equal(exported.schemaVersion, codeSchemaVersion());
  assert.equal(exported.tables.find((t) => t.name === "revisions")?.rows, updates.length + BULK);
});

test("secrets stay encrypted in the archive", () => {
  const text = gunzipSync(readFileSync(archive)).toString("utf-8");
  assert.ok(text.includes(encrypted));
  assert.equal(text.includes("s3cr3t-never-in-clear"), false);
  assert.equal(text.includes("hash-ada") && text.includes("sess-1"), false, "sessions are not exported");
});

test("round trip into a fresh database restores rows, bytes, secrets and counters", async () => {
  const target = await createThrowawayDatabase("archive_dst");
  try {
    const result = await runImport(target.url, archive);
    assert.equal(result.code, 0, result.out);

    const tables = exported.tables.map((t) => t.name);
    assert.deepEqual(await tableCounts(target.url, tables), await tableCounts(sourceUrl, tables));

    const user = (
      await query<{ email: string; display_name: string; is_admin: number }>(target.url, "SELECT * FROM users")
    )[0];
    assert.equal(user.email, "ada@example.com");
    assert.equal(user.display_name, 'Ada "quoted" \\ é 日本');

    const revs = await query<{ yjs_update: Buffer; label: string | null }>(
      target.url,
      "SELECT yjs_update, label FROM revisions WHERE author = 'ada' ORDER BY seq",
    );
    assert.deepEqual(
      revs.map((r) => r.yjs_update.toString("hex")),
      updates.map((u) => u.toString("hex")),
    );
    assert.equal(revs[0].label, "line1\nline2");

    const conn = (
      await query<{ config_encrypted: string }>(target.url, "SELECT config_encrypted FROM db_connections")
    )[0];
    assert.equal(conn.config_encrypted, encrypted);
    assert.deepEqual(decryptPayload(conn.config_encrypted), connectionConfig);

    assert.equal((await query(target.url, "SELECT 1 FROM sessions")).length, 0);
    // Identity counters continue after the restored rows.
    const maxSeq = Number((await query<{ m: string }>(target.url, "SELECT MAX(seq) AS m FROM revisions"))[0].m);
    await query(
      target.url,
      "INSERT INTO revisions (id, project_id, author, yjs_update) VALUES ('after', $1, 'x', '\\x00')",
      [projectId],
    );
    const after = Number(
      (await query<{ s: string }>(target.url, "SELECT seq AS s FROM revisions WHERE id = 'after'"))[0].s,
    );
    assert.ok(after > maxSeq);

    // A second import into the same, now occupied database is refused and changes nothing.
    const again = await runImport(target.url, archive);
    assert.notEqual(again.code, 0);
    assert.match(again.out, /not empty/);
    assert.equal(Number((await query<{ n: string }>(target.url, "SELECT COUNT(*) AS n FROM users"))[0].n), 1);
  } finally {
    await target.drop();
  }
});

test("an archive from a newer schema version is refused", async () => {
  const newer = join(dir, "newer.jsonl.gz");
  rewriteArchive(archive, newer, (lines) => {
    const header = JSON.parse(lines[0]);
    header.schemaVersion = codeSchemaVersion() + 1;
    return [JSON.stringify(header), ...lines.slice(1)];
  });
  const target = await createThrowawayDatabase("archive_newer");
  try {
    const result = await runImport(target.url, newer);
    assert.notEqual(result.code, 0);
    assert.match(result.out, /newer than this NebulaDB/);
  } finally {
    await target.drop();
  }
});

test("a tampered, truncated or foreign archive is refused and leaves the database empty", async () => {
  const edited = join(dir, "edited.jsonl.gz");
  rewriteArchive(archive, edited, (lines) => {
    const i = lines.findIndex((l) => l.startsWith('{"t":"users"'));
    return lines.map((l, k) => (k === i ? l.replace("ada@example.com", "eve@example.com") : l));
  });
  const noManifest = join(dir, "no-manifest.jsonl.gz");
  rewriteArchive(archive, noManifest, (lines) => lines.slice(0, -1));
  const cut = join(dir, "cut.jsonl.gz");
  writeFileSync(cut, readFileSync(archive).subarray(0, 2000));
  const foreign = join(dir, "foreign.jsonl.gz");
  writeFileSync(foreign, gzipSync('{"hello":"world"}\n'));

  const target = await createThrowawayDatabase("archive_bad");
  try {
    for (const [file, pattern] of [
      [edited, /manifest/],
      [noManifest, /truncated/],
      [cut, /cannot read the archive|corrupt|truncated/],
      [foreign, /not a NebulaDB instance archive/],
    ] as const) {
      const result = await runImport(target.url, file);
      assert.notEqual(result.code, 0, file);
      assert.match(result.out, pattern, file);
      assert.equal(Number((await query<{ n: string }>(target.url, "SELECT COUNT(*) AS n FROM users"))[0].n), 0, file);
      assert.equal(
        Number((await query<{ n: string }>(target.url, "SELECT COUNT(*) AS n FROM revisions"))[0].n),
        0,
        file,
      );
    }
  } finally {
    await target.drop();
  }
});
