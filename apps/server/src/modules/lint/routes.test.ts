import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-lint-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function login(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}` };
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** Grants `userId` a level on the project through a team — the only way a non-owner gets one. */
function grant(projectId: string, userId: string, permission: string) {
  const teamId = randomUUID();
  db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
    projectId,
    teamId,
    permission,
  );
}

/** A project whose only table has neither a key, a description nor timestamps. */
async function createProject(app: App, cookie: string) {
  const project = (await call(app, cookie, "POST", "/api/projects", { name: "Shop" })).json() as {
    id: string;
    name: string;
  };
  const room = getRoom(project.id);
  room.doc.transact(() => {
    writeProjectToDoc(room.doc, {
      id: project.id,
      name: project.name,
      tables: [
        {
          id: "t-widgets",
          name: "widgets",
          fields: [{ id: "f-label", name: "label", type: "text" }],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard",
        },
      ],
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    });
  });
  return project;
}

interface Report {
  profile: string;
  blockDeployment: boolean;
  summary: { error: number; warning: number; info: number };
  findings: { ruleId: string; severity: string; tableName: string }[];
}

test("lint: defaults, who may change the rules, what is refused, and the public report", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const viewer = await login(app);
    const stranger = await login(app);
    const project = await createProject(app, owner.cookie);
    grant(project.id, viewer.id, "edit");
    const url = `/api/projects/${project.id}/lint`;

    // Nothing saved yet: the standard profile, nothing blocked.
    const initial = (await call(app, owner.cookie, "GET", url)).json() as { settings: Record<string, unknown> };
    assert.deepEqual(initial.settings, {
      profile: "standard",
      rules: {},
      ignores: [],
      forbiddenTypes: [],
      requiredColumns: [],
      blockDeployment: false,
    });
    assert.equal((await call(app, viewer.cookie, "GET", url)).statusCode, 200);
    assert.equal((await call(app, stranger.cookie, "GET", url)).statusCode, 403);

    const strict = { profile: "strict", rules: { timestamps: "off" }, blockDeployment: true };
    // Editing the schema is not choosing its rules.
    assert.equal((await call(app, viewer.cookie, "PUT", url, strict)).statusCode, 403);
    const bad = await call(app, owner.cookie, "PUT", url, { profile: "strict", rules: { timestamps: "fatal" } });
    assert.equal(bad.statusCode, 400);
    assert.equal((bad.json() as { code: string }).code, "LINT_INVALID");

    const saved = await call(app, owner.cookie, "PUT", url, strict);
    assert.equal(saved.statusCode, 200);
    const again = (await call(app, viewer.cookie, "GET", url)).json() as { settings: typeof strict };
    assert.equal(again.settings.profile, "strict");
    assert.equal(again.settings.blockDeployment, true);
    assert.deepEqual(again.settings.rules, { timestamps: "off" });
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'project.lint'").get() as { n: number }).n,
      1,
    );

    const report = (await call(app, viewer.cookie, "GET", `/api/v1/projects/${project.id}/lint`)).json() as Report;
    assert.equal(report.profile, "strict");
    assert.equal(report.blockDeployment, true);
    assert.deepEqual(
      report.findings.map((f) => [f.ruleId, f.severity]),
      [
        ["pk-required", "error"],
        ["table-description", "warning"],
        ["column-description", "info"],
      ],
    );
    assert.deepEqual(report.summary, { error: 1, warning: 1, info: 1 });
    assert.equal((await call(app, stranger.cookie, "GET", `/api/v1/projects/${project.id}/lint`)).statusCode, 403);

    // The settings go with the project.
    assert.equal((await call(app, owner.cookie, "DELETE", `/api/projects/${project.id}`)).statusCode, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM lint_settings").get() as { n: number }).n, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("lint: a deployment is refused on an error when the project asks for it, and only then", async () => {
  const app = await buildApp();
  const file = join(mkdtempSync(join(tmpdir(), "athanordb-lint-")), "target.sqlite");
  try {
    const owner = await login(app);
    const project = await createProject(app, owner.cookie);
    const base = `/api/projects/${project.id}`;
    const created = await call(app, owner.cookie, "POST", `${base}/connections`, {
      name: "Local",
      engine: "sqlite",
      filePath: file,
    });
    const connId = (created.json() as { connection: { id: string } }).connection.id;
    const deploy = () => call(app, owner.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {});
    const tablesInTarget = () => {
      if (!existsSync(file)) return [];
      const target = new Database(file, { readonly: true });
      try {
        return (target.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
          (row) => row.name,
        );
      } finally {
        target.close();
      }
    };

    const blockers = async () =>
      (await call(app, owner.cookie, "POST", `${base}/connections/${connId}/plan-deployment`, {})).json().blockers;
    // Errors only count against a deployment when the project asked for that.
    await call(app, owner.cookie, "PUT", `${base}/lint`, { profile: "strict" });
    assert.deepEqual(await blockers(), { lintErrors: 0, lintFindings: [], waitsForStage: null });
    await call(app, owner.cookie, "PUT", `${base}/lint`, { profile: "strict", blockDeployment: true });
    // The plan names what blocks, so the dialog can say it before "Apply".
    const blocked = await blockers();
    assert.equal(blocked.lintErrors, 1);
    assert.deepEqual(
      blocked.lintFindings.map((finding: { ruleId: string; tableName: string }) => [finding.ruleId, finding.tableName]),
      [["pk-required", "widgets"]],
    );
    assert.deepEqual(blocked.lintFindings[0].params, { table: "widgets" });
    const refused = await deploy();
    assert.equal(refused.statusCode, 409, refused.body);
    const body = refused.json() as { code: string; count: number; findings: { ruleId: string }[] };
    assert.equal(body.code, "LINT_BLOCKS_DEPLOYMENT");
    assert.equal(body.count, 1);
    assert.equal(body.findings[0].ruleId, "pk-required");
    assert.deepEqual(tablesInTarget(), []);

    // An exception for the one table settles it: warnings never block.
    await call(app, owner.cookie, "PUT", `${base}/lint`, {
      profile: "strict",
      blockDeployment: true,
      ignores: [{ ruleId: "pk-required", tableId: "t-widgets", tableName: "widgets" }],
    });
    const allowed = await deploy();
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.deepEqual(tablesInTarget(), ["widgets"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
