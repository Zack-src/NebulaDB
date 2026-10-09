import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-migexport-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { recordDeployment } = await import("./deploymentHistory.js");
const { createZip } = await import("../../shared/zip.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = res.cookies.find((c) => c.name === "nebuladb_sid");
  return `nebuladb_sid=${sessionCookie!.value}`;
}

async function makeUser(displayName: string | null = null) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, ?)").run(
    id,
    email,
    await hashPassword(password),
    displayName,
  );
  return { id, email, password };
}

const UP_1 = "BEGIN;\nCREATE TABLE widgets (\n  id INTEGER PRIMARY KEY\n);\nCOMMIT;\n";
const DOWN_1 = "BEGIN;\nDROP TABLE widgets;\nCOMMIT;\n";
const UP_2 =
  "BEGIN;\nALTER TABLE widgets ADD COLUMN label TEXT;\nCREATE INDEX idx_label ON widgets (label);\nCOMMIT;\n";
const DOWN_2 = "-- WARNING: nothing to see\n\nBEGIN;\nDROP INDEX idx_label;\nCOMMIT;\n";

/** Two deployments, a rollback of the second, then a partial failure. */
function seedHistory(projectId: string, connectionId: string, author: string) {
  const base = {
    projectId,
    connectionId,
    connectionName: "Staging DB",
    environment: "staging",
    engine: "postgres" as const,
    executedByEmail: author,
  };
  const first = recordDeployment({
    ...base,
    sql: UP_1,
    rollbackSql: DOWN_1,
    success: true,
    executedStatements: 3,
    totalStatements: 3,
    schemaHash: "aaaa1111bbbb2222",
    seedReport: [{ tableName: "widgets", inserted: 4, skipped: false }],
  });
  const second = recordDeployment({
    ...base,
    sql: UP_2,
    rollbackSql: DOWN_2,
    success: true,
    executedStatements: 4,
    totalStatements: 4,
    schemaHash: "cccc3333dddd4444",
  });
  recordDeployment({
    ...base,
    sql: DOWN_2,
    rollbackSql: null,
    rollbackOf: second,
    success: true,
    executedStatements: 3,
    totalStatements: 3,
  });
  recordDeployment({
    ...base,
    sql: "BEGIN;\nDROP TABLE nope;\nCOMMIT;\n",
    rollbackSql: "BEGIN;\nCREATE TABLE nope (id INT);\nCOMMIT;\n",
    success: false,
    executedStatements: 1,
    totalStatements: 3,
    error: "connect ECONNREFUSED db.internal.example:5432 password=hunter2",
    schemaHash: "eeee5555",
  });
  return { first, second };
}

async function setup(app: Awaited<ReturnType<typeof buildApp>>, displayName: string | null) {
  const owner = await makeUser(displayName);
  const cookie = await loginAs(app, owner.email, owner.password);
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name: "Shop\nDROP TABLE x; -- évil" },
  });
  const project = created.json();
  const connRes = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/connections`,
    headers: headers({ cookie }),
    payload: { name: "Staging DB", engine: "sqlite", database: ":memory:" },
  });
  const connId = connRes.json().connection.id as string;
  seedHistory(project.id, connId, owner.email);
  return { owner, cookie, project, connId };
}

/** Reads a zip back with the system `unzip`: name -> content. Null when it is not installed. */
function unzipAll(archive: Buffer): Map<string, string> | null {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-test-zip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, archive);
  const probe = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
  if (probe.error) return null;
  assert.equal(probe.status, 0, `unzip -t failed: ${probe.stdout}${probe.stderr}`);
  const names = spawnSync("unzip", ["-Z1", file], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const files = new Map<string, string>();
  for (const name of names) {
    files.set(name, spawnSync("unzip", ["-p", file, name], { encoding: "utf8" }).stdout);
  }
  return files;
}

async function download(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  projectId: string,
  connId: string,
  format: string,
) {
  const res = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/connections/${connId}/history/export?format=${format}`,
    headers: headers({ cookie }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/zip");
  assert.match(String(res.headers["content-disposition"]), /attachment; filename="[a-z0-9-]+-staging-db-[a-z]+\.zip"/);
  const files = unzipAll(res.rawPayload);
  assert.ok(files, "the `unzip` command is needed to check the archive");
  return files;
}

test("zip writer: a standard unzip reads names, contents and checksums", () => {
  const archive = createZip([
    { name: "migrations/one.sql", data: "SELECT 1;\n" },
    { name: "empty.txt", data: "" },
    { name: "big.bin", data: Buffer.alloc(100_000, 7) },
  ]);
  const files = unzipAll(archive);
  if (!files) return; // no `unzip` on this machine
  assert.deepEqual([...files.keys()], ["migrations/one.sql", "empty.txt", "big.bin"]);
  assert.equal(files.get("migrations/one.sql"), "SELECT 1;\n");
  assert.equal(files.get("big.bin")!.length, 100_000);
});

test("migration export, plain SQL: numbered files, undo files, transaction wrapper kept", async () => {
  const app = await buildApp();
  try {
    const { cookie, project, connId } = await setup(app, "Ada Lovelace");
    const files = await download(app, cookie, project.id, connId, "sql");

    assert.deepEqual([...files.keys()].sort(), [
      "README.md",
      "migrations/0001_schema_aaaa1111.down.sql",
      "migrations/0001_schema_aaaa1111.sql",
      "migrations/0002_schema_cccc3333.down.sql",
      "migrations/0002_schema_cccc3333.sql",
      "migrations/0003_rollback_of_0002.sql",
    ]);
    const first = files.get("migrations/0001_schema_aaaa1111.sql")!;
    assert.match(first, /^-- NebulaDB migration 0001\n-- Project: Shop DROP TABLE x; -- évil\n/);
    assert.match(
      first,
      /-- Connection: Staging DB\n-- Environment: staging\n-- Date: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n-- Author: Ada Lovelace\n-- Schema hash: aaaa1111bbbb2222\n/,
    );
    assert.ok(first.endsWith(UP_1), "the SQL is the stored SQL, wrapper included");
    assert.ok(files.get("migrations/0001_schema_aaaa1111.down.sql")!.endsWith(DOWN_1));
    // Every line of the header is a comment: a project name cannot smuggle a statement in.
    for (const line of first.split("\n").slice(0, 7)) assert.ok(line.startsWith("-- "), line);
    assert.ok(files.get("migrations/0003_rollback_of_0002.sql")!.endsWith(DOWN_2));

    const readme = files.get("README.md")!;
    assert.match(readme, /Left out: failed or partial/);
    assert.match(readme, /partial \(1\/3 statements ran\)/);
    assert.match(readme, /widgets \+4/, "seeds are reported, not exported");
    for (const [name, content] of files) {
      assert.ok(!/ECONNREFUSED|hunter2|db\.internal|password=/.test(content), `${name} leaks a failure message`);
    }
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("migration export, Flyway: V<version>__<description> and U undo files, no transaction wrapper", async () => {
  const app = await buildApp();
  try {
    const { cookie, project, connId } = await setup(app, null);
    const files = await download(app, cookie, project.id, connId, "flyway");

    assert.deepEqual([...files.keys()].sort(), [
      "README.md",
      "migrations/U0001__schema_aaaa1111.sql",
      "migrations/U0002__schema_cccc3333.sql",
      "migrations/V0001__schema_aaaa1111.sql",
      "migrations/V0002__schema_cccc3333.sql",
      "migrations/V0003__rollback_of_0002.sql",
    ]);
    for (const name of files.keys()) {
      if (name.startsWith("migrations/")) assert.match(name, /^migrations\/[VU]\d+__[a-z0-9_]+\.sql$/);
      assert.ok(!name.slice(name.indexOf("__") + 2).includes("__"), "no double underscore in a description");
    }
    const v1 = files.get("migrations/V0001__schema_aaaa1111.sql")!;
    assert.ok(!/^(BEGIN|COMMIT);$/m.test(v1));
    assert.match(v1, /CREATE TABLE widgets \(\n {2}id INTEGER PRIMARY KEY\n\);\n$/);
    assert.match(
      files.get("migrations/U0002__schema_cccc3333.sql")!,
      /-- WARNING: nothing to see\n\nDROP INDEX idx_label;\n$/,
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("migration export, Liquibase: formatted SQL changesets, rollback lines, master changelog in order", async () => {
  const app = await buildApp();
  try {
    const { cookie, project, connId } = await setup(app, "Ada Lovelace");
    const files = await download(app, cookie, project.id, connId, "liquibase");

    assert.deepEqual([...files.keys()].sort(), [
      "README.md",
      "migrations/0001_schema_aaaa1111.sql",
      "migrations/0002_schema_cccc3333.sql",
      "migrations/0003_rollback_of_0002.sql",
      "migrations/changelog-master.yaml",
    ]);
    const second = files.get("migrations/0002_schema_cccc3333.sql")!;
    assert.ok(second.startsWith("--liquibase formatted sql\n"));
    assert.match(second, /^--changeset nebuladb:0002 splitStatements:true endDelimiter:; dbms:postgresql$/m);
    assert.match(second, /^-- Author: Ada Lovelace$/m);
    assert.match(second, /^ALTER TABLE widgets ADD COLUMN label TEXT;\nCREATE INDEX idx_label ON widgets \(label\);$/m);
    assert.match(second, /^--rollback DROP INDEX idx_label;$/m);
    assert.ok(!/^(BEGIN|COMMIT);$/m.test(second));
    // One changeset header per file, and the rollback entry (nothing stored to undo it) has no rollback line.
    assert.equal(second.match(/^--changeset/gm)!.length, 1);
    assert.ok(!/^--rollback/m.test(files.get("migrations/0003_rollback_of_0002.sql")!));

    assert.equal(
      files.get("migrations/changelog-master.yaml"),
      [
        "# NebulaDB changelog — Shop DROP TABLE x; -- évil / Staging DB",
        "databaseChangeLog:",
        "  - include:",
        "      file: 0001_schema_aaaa1111.sql",
        "      relativeToChangelogFile: true",
        "  - include:",
        "      file: 0002_schema_cccc3333.sql",
        "      relativeToChangelogFile: true",
        "  - include:",
        "      file: 0003_rollback_of_0002.sql",
        "      relativeToChangelogFile: true",
        "",
      ].join("\n"),
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("migration export: a later deployment only adds files; names of the earlier ones do not move", async () => {
  const app = await buildApp();
  try {
    const { cookie, project, connId, owner } = await setup(app, null);
    const before = [...(await download(app, cookie, project.id, connId, "flyway")).keys()].filter(
      (n) => n !== "README.md",
    );
    recordDeployment({
      projectId: project.id,
      connectionId: connId,
      connectionName: "Staging DB",
      environment: "staging",
      engine: "postgres",
      sql: "CREATE TABLE gadgets (id INT);\n",
      rollbackSql: null,
      success: true,
      executedStatements: 1,
      totalStatements: 1,
      executedByEmail: owner.email,
      schemaHash: "ffff6666",
    });
    const after = [...(await download(app, cookie, project.id, connId, "flyway")).keys()].filter(
      (n) => n !== "README.md",
    );
    assert.deepEqual(after.filter((n) => before.includes(n)).sort(), before.sort());
    assert.deepEqual(
      after.filter((n) => !before.includes(n)),
      ["migrations/V0004__schema_ffff6666.sql"],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("migration export: project administrators only, a known format, a connection of the project", async () => {
  const app = await buildApp();
  try {
    const { cookie, project, connId } = await setup(app, null);
    const stranger = await makeUser();
    const strangerCookie = await loginAs(app, stranger.email, stranger.password);
    const url = (conn: string, format = "sql") =>
      `/api/projects/${project.id}/connections/${conn}/history/export?format=${format}`;

    const forbidden = await app.inject({
      method: "GET",
      url: url(connId),
      headers: headers({ cookie: strangerCookie }),
    });
    assert.equal(forbidden.statusCode, 403);
    const anonymous = await app.inject({ method: "GET", url: url(connId), headers: headers() });
    assert.equal(anonymous.statusCode, 401);
    const badFormat = await app.inject({ method: "GET", url: url(connId, "rails"), headers: headers({ cookie }) });
    assert.equal(badFormat.statusCode, 400);
    assert.equal(badFormat.json().code, "MIGRATION_FORMAT_INVALID");
    const unknown = await app.inject({ method: "GET", url: url(randomUUID()), headers: headers({ cookie }) });
    assert.equal(unknown.statusCode, 404);

    const exports = () =>
      db
        .prepare("SELECT detail FROM audit_log WHERE action = 'connection.migrations_export' AND connection_id = ?")
        .all(connId) as { detail: string }[];
    assert.equal(exports().length, 0, "refused requests are not audited as exports");
    await download(app, cookie, project.id, connId, "sql");
    const after = exports();
    assert.equal(after.length, 1);
    assert.match(after[0]!.detail, /sql, \d+ files/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

// Not asserted here: that Flyway and Liquibase themselves accept the files. Neither is installed where these
// tests run, so the formats were written from their documentation. Run them for real when one is around.
test("migration export: Flyway or Liquibase, when installed, accept the files", async (t) => {
  const tool = ["flyway", "liquibase"].find((cmd) => !spawnSync(cmd, ["--version"]).error);
  if (!tool) return t.skip("neither flyway nor liquibase is installed");
  const app = await buildApp();
  try {
    const { cookie, project, connId } = await setup(app, null);
    const format = tool === "flyway" ? "flyway" : "liquibase";
    const files = await download(app, cookie, project.id, connId, format);
    const dir = mkdtempSync(join(tmpdir(), "nebuladb-test-tool-"));
    mkdirSync(join(dir, "migrations"));
    for (const [name, content] of files) if (name.startsWith("migrations/")) writeFileSync(join(dir, name), content);
    const run =
      tool === "flyway"
        ? spawnSync("flyway", [
            "-url=jdbc:sqlite::memory:",
            `-locations=filesystem:${join(dir, "migrations")}`,
            "validate",
          ])
        : spawnSync("liquibase", [`--changelog-file=${join(dir, "migrations/changelog-master.yaml")}`, "validate"]);
    assert.equal(run.status, 0, String(run.stdout) + String(run.stderr));
  } finally {
    closeAllRooms();
    await app.close();
  }
});
