import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-pipeline-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";
// Not what is under test here, and it would write a file per production deployment.
process.env.ATHANORDB_DATABASE_BACKUP_DIR = mkdtempSync(join(tmpdir(), "athanordb-pipeline-backups-"));

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App, isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(password),
    isAdmin,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

interface Pipeline {
  stages: {
    name: string;
    requires: string | null;
    ready: boolean;
    connections: { name: string; level: boolean; lastDeployment: { success: boolean } | null }[];
  }[];
  unstaged: { name: string }[];
}

test("pipeline: a guarded stage takes a schema only after the stage before it; an instance administrator may skip, with a reason", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const owner = await login(app);
    const editor = await login(app);

    // DEV free › Staging review › Prod production: the chain a fresh instance starts with, made explicit.
    const chain = (await call(app, admin.cookie, "GET", "/api/environments")).json().environments as {
      id: string;
      name: string;
    }[];
    const stage = (name: string) => chain.find((entry) => entry.name === name)!.id;
    await call(app, admin.cookie, "PATCH", `/api/admin/environments/${stage("DEV")}`, { protection: "free" });
    await call(app, admin.cookie, "PATCH", `/api/admin/environments/${stage("Staging")}`, { protection: "review" });

    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    const importSchema = (source: string) => call(app, owner.cookie, "POST", `${base}/import`, { source });
    await importSchema("Table customers {\n  id integer [pk]\n}\n");
    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
    db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, editor.id);
    db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, 'edit')").run(
      project.id,
      teamId,
    );

    const dir = mkdtempSync(join(tmpdir(), "athanordb-pipeline-"));
    const connect = async (name: string, environmentId: string | null) =>
      (
        await call(app, owner.cookie, "POST", `${base}/connections`, {
          name,
          engine: "sqlite",
          filePath: join(dir, `${name}.sqlite`),
          environmentId,
        })
      ).json().connection.id as string;
    const dev = await connect("dev", stage("DEV"));
    const staging = await connect("staging", stage("Staging"));
    const prod = await connect("prod", stage("Prod"));
    await connect("scratch", null);
    const deploy = (cookie: string, connId: string, extra: Record<string, unknown> = {}) =>
      call(app, cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {
        resolutions: {},
        confirmName: "prod",
        backupBefore: false,
        ...extra,
      });
    const pipeline = async () => (await call(app, owner.cookie, "GET", `${base}/pipeline`)).json().pipeline as Pipeline;
    const summary = async () =>
      (await pipeline()).stages.map((entry) => [entry.name, entry.requires, entry.ready, entry.connections[0]?.level]);

    assert.equal((await call(app, editor.cookie, "GET", `${base}/pipeline`)).statusCode, 403);
    assert.deepEqual(await summary(), [
      ["DEV", null, true, false],
      ["Staging", "DEV", false, false],
      ["Prod", "Staging", false, false],
    ]);
    assert.deepEqual(
      (await pipeline()).unstaged.map((connection) => connection.name),
      ["scratch"],
    );

    // Out of order: refused, with the stage that has to come first.
    const early = await deploy(owner.cookie, prod);
    assert.equal(early.statusCode, 409, early.body);
    assert.equal(early.json().code, "PIPELINE_STAGE_SKIPPED");
    assert.deepEqual([early.json().stage, early.json().requires], ["Prod", "Staging"]);
    assert.equal((await deploy(owner.cookie, staging)).json().code, "PIPELINE_STAGE_SKIPPED");

    // In order: each stage opens the next.
    assert.equal((await deploy(owner.cookie, dev)).statusCode, 200);
    assert.deepEqual((await summary())[1], ["Staging", "DEV", true, false]);
    assert.equal((await deploy(owner.cookie, staging)).statusCode, 200);
    assert.equal((await deploy(owner.cookie, prod)).statusCode, 200);
    assert.deepEqual(await summary(), [
      ["DEV", null, true, true],
      ["Staging", "DEV", true, true],
      ["Prod", "Staging", true, true],
    ]);

    // The schema moves on: every stage is behind again, and production waits for staging.
    await importSchema("Table customers {\n  id integer [pk]\n  email varchar(320)\n}\n");
    assert.deepEqual(await summary(), [
      ["DEV", null, true, false],
      ["Staging", "DEV", false, false],
      ["Prod", "Staging", false, false],
    ]);
    assert.equal((await deploy(owner.cookie, prod)).json().code, "PIPELINE_STAGE_SKIPPED");

    // The urgent fix: not for a project administrator, not without a reason, and on the record.
    assert.equal((await deploy(owner.cookie, prod, { skipStageOrder: true, skipReason: "hotfix" })).statusCode, 403);
    assert.equal(
      (await deploy(admin.cookie, prod, { skipStageOrder: true, skipReason: "  " })).json().code,
      "STAGE_SKIP_REASON_REQUIRED",
    );
    const skipped = await deploy(admin.cookie, prod, { skipStageOrder: true, skipReason: "hotfix: login outage" });
    assert.equal(skipped.statusCode, 200, skipped.body);
    assert.deepEqual(
      db.prepare("SELECT detail, connection_id FROM audit_log WHERE action = 'connection.deploy.stage_skipped'").all(),
      [{ detail: "hotfix: login outage", connection_id: prod }],
    );
    assert.deepEqual((await summary())[2], ["Prod", "Staging", false, true]);

    // A database on no stage is outside the pipeline: deployed whenever.
    assert.equal((await deploy(owner.cookie, await connect("loose", null))).statusCode, 200);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
