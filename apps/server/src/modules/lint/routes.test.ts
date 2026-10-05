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
      customRules: [],
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

async function loginAdmin(app: App) {
  const session = await login(app);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(session.id);
  return session;
}

const appPrefix = {
  id: "app-prefix",
  label: "Tables start with app_",
  target: "table",
  must: "match",
  pattern: "^app_",
  level: "error",
};

const orderPreset = (extra: Record<string, unknown> = {}) => ({
  profile: "relaxed",
  customRules: [appPrefix],
  blockDeployment: true,
  ...extra,
});

interface LintState {
  settings: { profile: string; customRules: { id: string }[]; blockDeployment: boolean };
  source: { kind: string; presetId?: string; presetName?: string };
  presets: { id: string; name: string; isDefault: boolean }[];
}

test("lint presets: the library is for instance administrators, one is the default, a project follows or keeps its own", async () => {
  const app = await buildApp();
  try {
    const admin = await loginAdmin(app);
    const owner = await login(app);
    const member = await login(app);
    const project = await createProject(app, owner.cookie);
    grant(project.id, member.id, "edit");
    const url = `/api/projects/${project.id}/lint`;
    const state = async (cookie = owner.cookie) => (await call(app, cookie, "GET", url)).json() as LintState;
    const presetsUrl = "/api/admin/lint-presets";

    // Not the project administrators', not members': only instance administrators.
    assert.equal((await call(app, owner.cookie, "GET", presetsUrl)).statusCode, 403);
    const forbidden = await call(app, owner.cookie, "POST", presetsUrl, { name: "x", settings: orderPreset() });
    assert.equal(forbidden.statusCode, 403);

    // Without any preset: the built-in defaults.
    assert.equal((await state()).source.kind, "builtin");
    assert.deepEqual((await state()).presets, []);

    // Invalid settings are refused; a good preset is created, with a unique name.
    const badRule = { ...appPrefix, pattern: "(" };
    const refused = await call(app, admin.cookie, "POST", presetsUrl, {
      name: "Bad",
      settings: orderPreset({ customRules: [badRule] }),
    });
    assert.equal(refused.statusCode, 400);
    assert.equal((refused.json() as { code: string }).code, "LINT_INVALID");
    const created = await call(app, admin.cookie, "POST", presetsUrl, {
      name: "Company",
      description: "Our conventions",
      settings: orderPreset(),
    });
    assert.equal(created.statusCode, 201);
    const preset = (created.json() as { preset: { id: string; isDefault: boolean } }).preset;
    assert.equal(preset.isDefault, false);
    const same = await call(app, admin.cookie, "POST", presetsUrl, { name: "company", settings: orderPreset() });
    assert.equal((same.json() as { code: string }).code, "LINT_PRESET_NAME_TAKEN");

    // Not the default yet: the project keeps the built-in rules; only its administrators are offered the preset.
    assert.equal((await state()).source.kind, "builtin");
    assert.deepEqual(
      (await state()).presets.map((p) => p.name),
      ["Company"],
    );
    assert.deepEqual((await state(member.cookie)).presets, []);

    // The default applies to every project that chose nothing.
    const made = await call(app, admin.cookie, "PUT", `${presetsUrl}/default`, { id: preset.id });
    assert.equal(made.statusCode, 200);
    const viaDefault = await state();
    assert.equal(viaDefault.source.kind, "default");
    assert.equal(viaDefault.source.presetName, "Company");
    assert.equal(viaDefault.settings.blockDeployment, true);
    const report = (await call(app, member.cookie, "GET", `/api/v1/projects/${project.id}/lint`)).json() as Report & {
      source: { kind: string };
    };
    assert.equal(report.source.kind, "default");
    assert.ok(
      report.findings.some((f) => f.ruleId === "custom:app-prefix" && f.severity === "error"),
      "the custom rule runs",
    );

    // A project's own version wins, and is the project's alone.
    const own = await call(app, owner.cookie, "PUT", url, { settings: { profile: "relaxed", customRules: [] } });
    assert.equal((own.json() as LintState).source.kind, "own");
    assert.equal((await state()).settings.customRules.length, 0);
    assert.equal((await call(app, member.cookie, "PUT", url, { settings: { profile: "relaxed" } })).statusCode, 403);

    // Back to the default, or to a chosen preset (which drops the own version).
    const backToDefault = await call(app, owner.cookie, "PUT", url, { presetId: null });
    assert.equal((backToDefault.json() as LintState).source.kind, "default");
    const second = (
      (
        await call(app, admin.cookie, "POST", presetsUrl, { name: "Strict shop", settings: { profile: "strict" } })
      ).json() as {
        preset: { id: string };
      }
    ).preset;
    const chosen = (await call(app, owner.cookie, "PUT", url, { presetId: second.id })).json() as LintState;
    assert.equal(chosen.source.kind, "preset");
    assert.equal(chosen.settings.profile, "strict");
    assert.equal((await call(app, owner.cookie, "PUT", url, { presetId: "nope" })).statusCode, 404);
    assert.equal((await call(app, owner.cookie, "PUT", url, { presetId: 3 })).statusCode, 400);

    // Editing a preset reaches the projects that follow it; the list counts them.
    await call(app, admin.cookie, "PUT", `${presetsUrl}/${second.id}`, { settings: { profile: "relaxed" } });
    assert.equal((await state()).settings.profile, "relaxed");
    const listed = (await call(app, admin.cookie, "GET", presetsUrl)).json() as {
      presets: { id: string; projectCount: number }[];
      defaultId: string;
    };
    assert.equal(listed.defaultId, preset.id);
    assert.equal(listed.presets.find((p) => p.id === second.id)?.projectCount, 1);

    // Deleting a preset detaches its projects, which fall back to the default.
    const removed = (await call(app, admin.cookie, "DELETE", `${presetsUrl}/${second.id}`)).json() as {
      detached: number;
    };
    assert.equal(removed.detached, 1);
    assert.equal((await state()).source.kind, "default");
    assert.equal((await call(app, admin.cookie, "DELETE", `${presetsUrl}/${second.id}`)).statusCode, 404);

    // No default any more: the built-in rules.
    await call(app, admin.cookie, "PUT", `${presetsUrl}/default`, { id: null });
    assert.equal((await state()).source.kind, "builtin");

    // Applying a preset to projects; unknown ids are skipped.
    const applied = (
      await call(app, admin.cookie, "POST", `${presetsUrl}/${preset.id}/apply`, { projectIds: [project.id, "ghost"] })
    ).json();
    assert.deepEqual(applied, { applied: 1, skipped: ["ghost"] });
    assert.equal((await state()).source.kind, "preset");

    const actions = (
      db.prepare("SELECT action FROM audit_log WHERE action LIKE 'lint.preset.%'").all() as { action: string }[]
    ).map((row) => row.action);
    for (const action of ["create", "default", "update", "delete", "apply"]) {
      assert.ok(actions.includes(`lint.preset.${action}`), action);
    }

    // What the project followed goes with the project.
    assert.equal((await call(app, owner.cookie, "DELETE", `/api/projects/${project.id}`)).statusCode, 200);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("lint presets: a deployment is refused on the default preset's rules", async () => {
  const app = await buildApp();
  const file = join(mkdtempSync(join(tmpdir(), "athanordb-lint-preset-")), "target.sqlite");
  try {
    const admin = await loginAdmin(app);
    const owner = await login(app);
    const project = await createProject(app, owner.cookie);
    const base = `/api/projects/${project.id}`;
    const created = await call(app, owner.cookie, "POST", `${base}/connections`, {
      name: "Local",
      engine: "sqlite",
      filePath: file,
    });
    const connId = (created.json() as { connection: { id: string } }).connection.id;
    const blockers = async () =>
      (await call(app, owner.cookie, "POST", `${base}/connections/${connId}/plan-deployment`, {})).json().blockers;

    assert.equal((await blockers()).lintErrors, 0, "no preset: no refusal");
    const preset = (
      (
        await call(app, admin.cookie, "POST", "/api/admin/lint-presets", { name: "Blocking", settings: orderPreset() })
      ).json() as {
        preset: { id: string };
      }
    ).preset;
    await call(app, admin.cookie, "PUT", "/api/admin/lint-presets/default", { id: preset.id });
    assert.equal((await blockers()).lintErrors, 1, "'widgets' lacks the app_ prefix: an error, and the default blocks");
    const refused = await call(app, owner.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {});
    assert.equal((refused.json() as { code: string }).code, "LINT_BLOCKS_DEPLOYMENT");
    const target = new Database(file, { readonly: true });
    try {
      const tables = target.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      assert.deepEqual(tables, [], "nothing was deployed");
    } finally {
      target.close();
    }
  } finally {
    closeAllRooms();
    await app.close();
  }
});
