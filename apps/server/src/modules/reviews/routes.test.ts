import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("reviews");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
// Not what is under test here, and it would write a file per production deployment.
process.env.NEBULADB_DATABASE_BACKUP_DIR = mkdtempSync(join(tmpdir(), "nebuladb-reviews-backups-"));

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { REVIEW_APPROVAL_TTL_DAYS } = await import("@nebuladb/shared");

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App, isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)")
    .run(id, email, await hashPassword(password), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}
type Person = Awaited<ReturnType<typeof login>>;

const call = (app: App, cookie: string, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

interface Review {
  id: string;
  status: string;
  sql: string;
  message?: string;
  comment?: string;
  requestedByEmail: string;
  decidedByEmail?: string;
  decidedAt?: string;
  expiresAt?: string;
  closeReason?: string;
  deploymentId?: string;
  schemaChanged: boolean;
  viewer: { canDecide: boolean; canDeploy: boolean; canWithdraw: boolean };
}

const SCHEMA = "Table customers {\n  id integer [pk]\n}\n";
const SCHEMA_2 = "Table customers {\n  id integer [pk]\n  email varchar(320)\n}\n";
const SCHEMA_3 = "Table customers {\n  id integer [pk]\n  email varchar(320)\n  name varchar(80)\n}\n";

/**
 * DEV free › Staging review › Prod production, a project with a database on
 * DEV and one on Staging, its owner (administrator), a second person who may
 * deploy, and one who only edits.
 */
async function setup(app: App) {
  const admin = await login(app, 1);
  const owner = await login(app);
  const deployer = await login(app);
  const editor = await login(app);

  const chain = (await call(app, admin.cookie, "GET", "/api/environments")).json().environments as {
    id: string;
    name: string;
  }[];
  const stage = (name: string) => chain.find((entry) => entry.name === name)!.id;
  const protect = (name: string, protection: string) =>
    call(app, admin.cookie, "PATCH", `/api/admin/environments/${stage(name)}`, { protection });
  await protect("DEV", "free");
  await protect("Staging", "review");

  const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
  const base = `/api/projects/${project.id}`;
  const importSchema = (source: string) => call(app, owner.cookie, "POST", `${base}/import`, { source });
  await importSchema(SCHEMA);
  await call(app, owner.cookie, "PUT", `${base}/members/${deployer.id}`, { permission: "deploy" });
  await call(app, owner.cookie, "PUT", `${base}/members/${editor.id}`, { permission: "edit" });

  const dir = mkdtempSync(join(tmpdir(), "nebuladb-reviews-"));
  const fileOf = (name: string) => join(dir, `${name}.sqlite`);
  const connect = async (name: string, environmentId: string | null) =>
    (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name,
        engine: "sqlite",
        filePath: fileOf(name),
        environmentId,
      })
    ).json().connection.id as string;
  const dev = await connect("dev", stage("DEV"));
  const staging = await connect("staging", stage("Staging"));

  const deployDirectly = (who: Person, connId: string, extra: Record<string, unknown> = {}) =>
    call(app, who.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, { resolutions: {}, ...extra });
  const request = (who: Person, connId: string, extra: Record<string, unknown> = {}) =>
    call(app, who.cookie, "POST", `${base}/connections/${connId}/reviews`, { resolutions: {}, ...extra });
  const act = (who: Person, reviewId: string, action: string, payload: Record<string, unknown> = {}) =>
    call(app, who.cookie, "POST", `${base}/reviews/${reviewId}/${action}`, payload);
  const reviews = async (who: Person) =>
    (await call(app, who.cookie, "GET", `${base}/reviews`)).json().reviews as Review[];
  const reviewOf = async (who: Person, id: string) => (await reviews(who)).find((review) => review.id === id)!;
  /** A request by the owner, approved by the deployer. */
  const approved = async (connId: string) => {
    const made = await request(owner, connId);
    assert.equal(made.statusCode, 200, made.body);
    const id = (made.json().review as Review).id;
    const ok = await act(deployer, id, "approve");
    assert.equal(ok.statusCode, 200, ok.body);
    return id;
  };

  return {
    admin,
    owner,
    deployer,
    editor,
    project,
    base,
    stage,
    protect,
    importSchema,
    fileOf,
    connect,
    dev,
    staging,
    deployDirectly,
    request,
    act,
    reviews,
    reviewOf,
    approved,
  };
}

const notificationsOf = async (app: App, who: Person) =>
  (
    (await call(app, who.cookie, "GET", "/api/notifications")).json() as {
      notifications: { event: string; params: Record<string, unknown> }[];
    }
  ).notifications.filter((notification) => notification.event === "review");

test("review: a deployment to a review stage is requested, approved by another person, then deployed as it was read", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, deployer, editor, admin, base, dev, staging } = t;
    const hook = await call(app, owner.cookie, "POST", `${base}/webhooks`, {
      url: "http://127.0.0.1:9/hook",
      events: ["deployment.review"],
    });
    assert.equal(hook.statusCode, 201, hook.body);

    // The free stage deploys as before, and opens the next one.
    assert.equal((await t.deployDirectly(owner, dev)).statusCode, 200);

    // A direct deployment to the review stage is refused, whoever asks — the project's administrator,
    // an instance administrator, the public API.
    for (const who of [owner, deployer, admin]) {
      const direct = await t.deployDirectly(who, staging);
      assert.equal(direct.statusCode, 409, direct.body);
      assert.equal(direct.json().code, "DEPLOYMENT_REVIEW_REQUIRED");
    }
    const directV1 = await call(
      app,
      owner.cookie,
      "POST",
      `/api/v1/projects/${t.project.id}/connections/${staging}/deploy`,
      {},
    );
    assert.equal(directV1.json().code, "DEPLOYMENT_REVIEW_REQUIRED");
    // The plan itself stays what it was: the dialog reads it before asking for a review.
    assert.equal(
      (await call(app, owner.cookie, "POST", `${base}/connections/${staging}/plan-deployment`, {})).statusCode,
      200,
    );

    // Asking takes the level deploying takes; a review is only for a stage that asks for one.
    assert.equal((await t.request(editor, staging)).statusCode, 403);
    assert.equal((await call(app, editor.cookie, "GET", `${base}/reviews`)).statusCode, 403);
    assert.equal((await t.request(owner, dev)).json().code, "DEPLOYMENT_REVIEW_NOT_REQUIRED");

    const made = await t.request(owner, staging, { message: "First tables", riskNote: "none" });
    assert.equal(made.statusCode, 200, made.body);
    const review = made.json().review as Review;
    assert.equal(review.status, "pending");
    assert.match(review.sql, /CREATE TABLE/i);
    assert.equal(review.message, "First tables");
    assert.equal(review.requestedByEmail, owner.email);
    assert.deepEqual(review.viewer, { canDecide: false, canDeploy: false, canWithdraw: true });

    // One open request per project and connection.
    assert.equal((await t.request(deployer, staging)).json().code, "DEPLOYMENT_REVIEW_ALREADY_OPEN");

    // Those who can approve are told; the author is not told about their own request.
    assert.deepEqual(
      (await notificationsOf(app, deployer)).map((n) => [n.params.action, n.params.by, n.params.connection]),
      [["requested", owner.email, "staging"]],
    );
    assert.equal((await notificationsOf(app, admin)).length, 1, "an instance administrator can approve too");
    assert.equal((await notificationsOf(app, owner)).length, 0);
    assert.equal((await notificationsOf(app, editor)).length, 0);

    // Never by its author — not even the project's administrator.
    assert.deepEqual((await t.reviewOf(deployer, review.id)).viewer, {
      canDecide: true,
      canDeploy: false,
      canWithdraw: false,
    });
    for (const action of ["approve", "reject"]) {
      const self = await t.act(owner, review.id, action);
      assert.equal(self.statusCode, 403, self.body);
      assert.equal(self.json().code, "DEPLOYMENT_REVIEW_SELF_DECISION");
      assert.match(self.json().error, /instance administrator/);
    }
    assert.equal((await t.act(editor, review.id, "approve")).statusCode, 403);
    // Not deployed before it is approved.
    assert.equal((await t.act(owner, review.id, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");

    const approval = await t.act(deployer, review.id, "approve", { comment: "Looks right" });
    assert.equal(approval.statusCode, 200, approval.body);
    const approvedReview = approval.json().review as Review;
    assert.equal(approvedReview.status, "approved");
    assert.equal(approvedReview.decidedByEmail, deployer.email);
    assert.equal(approvedReview.comment, "Looks right");
    const lifetime =
      new Date(`${approvedReview.expiresAt!.replace(" ", "T")}Z`).getTime() -
      new Date(`${approvedReview.decidedAt!.replace(" ", "T")}Z`).getTime();
    assert.equal(lifetime, REVIEW_APPROVAL_TTL_DAYS * 24 * 3_600_000);
    assert.equal((await t.act(admin, review.id, "approve")).json().code, "DEPLOYMENT_REVIEW_NOT_PENDING");
    assert.deepEqual(
      (await notificationsOf(app, owner)).map((n) => [n.params.action, n.params.by]),
      [["approved", deployer.email]],
    );

    // Deployed by its author or its approver, nobody else.
    const outsider = await t.act(admin, review.id, "deploy");
    assert.equal(outsider.statusCode, 403);
    assert.equal(outsider.json().code, "DEPLOYMENT_REVIEW_NOT_YOURS");
    assert.deepEqual((await t.reviewOf(deployer, review.id)).viewer, {
      canDecide: false,
      canDeploy: true,
      canWithdraw: false,
    });
    // An approval does not open the stage to a direct deployment.
    assert.equal((await t.deployDirectly(owner, staging)).json().code, "DEPLOYMENT_REVIEW_REQUIRED");

    const deployed = await t.act(owner, review.id, "deploy");
    assert.equal(deployed.statusCode, 200, deployed.body);
    assert.equal(deployed.json().success, true);
    assert.equal(deployed.json().sql, review.sql, "what ran is what was read");

    const after = await t.reviewOf(owner, review.id);
    assert.equal(after.status, "deployed");
    assert.deepEqual(after.viewer, { canDecide: false, canDeploy: false, canWithdraw: false });
    assert.equal((await t.act(owner, review.id, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");

    // The history says who asked and who approved.
    const history = (await call(app, deployer.cookie, "GET", `${base}/connections/${staging}/history`)).json()
      .history as { id: string; executedByEmail: string; review?: Record<string, unknown> }[];
    assert.equal(history.length, 1);
    assert.equal(after.deploymentId, history[0].id);
    assert.equal(history[0].executedByEmail, owner.email);
    assert.deepEqual(
      [
        history[0].review?.requestedByEmail,
        history[0].review?.approvedByEmail,
        history[0].review?.message,
        history[0].review?.comment,
      ],
      [owner.email, deployer.email, "First tables", "Looks right"],
    );
    const devHistory = (await call(app, owner.cookie, "GET", `${base}/connections/${dev}/history`)).json().history;
    assert.equal(devHistory[0].review, undefined);

    // The pipeline counts it like any deployment.
    const pipeline = (await call(app, owner.cookie, "GET", `${base}/pipeline`)).json().pipeline as {
      stages: { name: string; connections: { level: boolean }[] }[];
    };
    assert.equal(pipeline.stages.find((entry) => entry.name === "Staging")!.connections[0].level, true);

    // Audited, each step under who took it.
    const audit = (await db
      .prepare(
        "SELECT action, actor_email FROM audit_log WHERE target_id = ? AND action LIKE 'connection.%' ORDER BY seq",
      )
      .all(t.project.id)) as { action: string; actor_email: string }[];
    assert.deepEqual(
      audit.filter((row) => row.action.startsWith("connection.review.") || row.action === "connection.deploy").slice(1),
      [
        { action: "connection.review.request", actor_email: owner.email },
        { action: "connection.review.approve", actor_email: deployer.email },
        { action: "connection.deploy", actor_email: owner.email },
      ],
    );

    // And sent to the project's webhooks.
    // Deliveries carry no insertion order of their own; within one second, "requested" came first.
    const events = (
      (await db
        .prepare(
          `SELECT d.payload FROM webhook_deliveries d JOIN project_webhooks w ON w.id = d.webhook_id WHERE w.project_id = ?
            ORDER BY d.created_at, (d.payload::json->'data'->>'action') DESC`,
        )
        .all(t.project.id)) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as { event: string; data: Record<string, unknown> });
    assert.deepEqual(
      events.map((entry) => [entry.event, entry.data.action, entry.data.requestedBy, entry.data.by]),
      [
        ["deployment.review", "requested", owner.email, owner.email],
        ["deployment.review", "approved", owner.email, deployer.email],
      ],
    );

    // A rollback is not a deployment of a schema: it undoes a recorded one, without a review.
    const rollback = await call(
      app,
      deployer.cookie,
      "POST",
      `${base}/connections/${staging}/history/${history[0].id}/rollback`,
      {},
    );
    assert.equal(rollback.statusCode, 200, rollback.body);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("review: an approval is for what was read — a schema or a database that moved since closes the request", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, deployer, staging } = t;
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);

    // The schema changes after the approval.
    const first = await t.approved(staging);
    await t.importSchema(SCHEMA_2);
    assert.equal((await t.reviewOf(owner, first)).schemaChanged, true);
    assert.equal(
      (await t.deployDirectly(owner, t.dev)).statusCode,
      200,
      "DEV follows, so the order is not what refuses",
    );
    const stale = await t.act(owner, first, "deploy");
    assert.equal(stale.statusCode, 409, stale.body);
    assert.deepEqual([stale.json().code, stale.json().reason], ["DEPLOYMENT_REVIEW_STALE", "schema"]);
    const closed = await t.reviewOf(owner, first);
    assert.deepEqual([closed.status, closed.closeReason], ["stale", "schema"]);
    const target = new Database(t.fileOf("staging"));
    const tables = target.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'customers'").get() as {
      n: number;
    };
    target.close();
    assert.equal(tables.n, 0, "nothing ran");
    assert.equal((await t.act(owner, first, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");

    // The schema changes before the approval: approving it would approve something nobody read.
    const second = (await t.request(owner, staging)).json().review as Review;
    await t.importSchema(SCHEMA_3);
    const late = await t.act(deployer, second.id, "approve");
    assert.deepEqual([late.statusCode, late.json().code], [409, "DEPLOYMENT_REVIEW_STALE"]);
    assert.equal((await t.reviewOf(owner, second.id)).status, "stale");
    assert.deepEqual(
      (await notificationsOf(app, owner)).map((n) => n.params.action).filter((action) => action === "stale"),
      ["stale"],
      "the author is told when someone else's action closes their request",
    );

    // The database changes after the approval, the schema does not.
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);
    const third = await t.approved(staging);
    const outside = new Database(t.fileOf("staging"));
    outside.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY)");
    outside.close();
    const moved = await t.act(deployer, third, "deploy");
    assert.deepEqual(
      [moved.statusCode, moved.json().code, moved.json().reason],
      [409, "DEPLOYMENT_REVIEW_STALE", "database"],
    );
    assert.deepEqual(
      [(await t.reviewOf(owner, third)).status, (await t.reviewOf(owner, third)).closeReason],
      ["stale", "database"],
    );

    // A new request takes the database as it is now, and goes through.
    const fourth = await t.approved(staging);
    const done = await t.act(deployer, fourth, "deploy");
    assert.equal(done.statusCode, 200, done.body);
    assert.equal((await t.reviewOf(owner, fourth)).status, "deployed");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("review: an approval expires, a request is withdrawn by its author or rejected with a comment", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, deployer, admin, staging } = t;
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);

    // Expiry: approved, then left longer than the approval lasts.
    const expiring = await t.approved(staging);
    await db.prepare("UPDATE deployment_reviews SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(expiring);
    const tooLate = await t.act(owner, expiring, "deploy");
    assert.deepEqual([tooLate.statusCode, tooLate.json().code], [409, "DEPLOYMENT_REVIEW_EXPIRED"]);
    assert.equal((await t.reviewOf(owner, expiring)).status, "expired");
    assert.equal((await t.deployDirectly(owner, staging)).json().code, "DEPLOYMENT_REVIEW_REQUIRED");

    // Withdrawal: the author's alone, and it frees the connection for a new request.
    const withdrawn = (await t.request(owner, staging)).json().review as Review;
    const notTheirs = await t.act(deployer, withdrawn.id, "withdraw");
    assert.deepEqual([notTheirs.statusCode, notTheirs.json().code], [403, "DEPLOYMENT_REVIEW_NOT_YOURS"]);
    const back = await t.act(owner, withdrawn.id, "withdraw");
    assert.equal(back.statusCode, 200, back.body);
    assert.equal((back.json().review as Review).status, "withdrawn");
    assert.equal((await t.act(deployer, withdrawn.id, "approve")).json().code, "DEPLOYMENT_REVIEW_NOT_PENDING");
    assert.equal((await t.act(owner, withdrawn.id, "withdraw")).json().code, "DEPLOYMENT_REVIEW_NOT_PENDING");

    // An approved request can be withdrawn too: the approval is then worth nothing.
    const regretted = await t.approved(staging);
    assert.equal((await t.act(owner, regretted, "withdraw")).statusCode, 200);
    assert.equal((await t.act(deployer, regretted, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");

    // Rejection, by an instance administrator who has no grant on the project, with a comment.
    const rejected = (await t.request(deployer, staging)).json().review as Review;
    const no = await t.act(admin, rejected.id, "reject", { comment: "Not this week" });
    assert.equal(no.statusCode, 200, no.body);
    assert.deepEqual(
      [
        (no.json().review as Review).status,
        (no.json().review as Review).comment,
        (no.json().review as Review).decidedByEmail,
      ],
      ["rejected", "Not this week", admin.email],
    );
    assert.equal((await t.act(deployer, rejected.id, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");
    assert.deepEqual((await notificationsOf(app, deployer)).map((n) => n.params.action).includes("rejected"), true);

    // An instance administrator's own request needs another person like anyone's.
    const byAdmin = (await t.request(admin, staging)).json().review as Review;
    assert.equal((await t.act(admin, byAdmin.id, "approve")).json().code, "DEPLOYMENT_REVIEW_SELF_DECISION");
    assert.equal((await t.act(owner, byAdmin.id, "approve")).statusCode, 200);
    assert.equal((await t.act(owner, byAdmin.id, "deploy")).statusCode, 200, "the approver may deploy it");
    assert.equal((await t.reviewOf(admin, byAdmin.id)).status, "deployed");

    assert.equal((await t.act(owner, randomUUID(), "approve")).json().code, "DEPLOYMENT_REVIEW_NOT_FOUND");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("review: the other rules stay on top — stage order, production confirmation and backup", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, deployer, admin, base, staging } = t;

    // Asked while DEV does not have the schema: the request stands, the deployment waits for the order.
    const early = await t.approved(staging);
    const refused = await t.act(owner, early, "deploy");
    assert.deepEqual([refused.statusCode, refused.json().code], [409, "PIPELINE_STAGE_SKIPPED"]);
    assert.equal((await t.reviewOf(owner, early)).status, "approved", "refused for the order, not closed");
    // Skipping the order stays an instance administrator's, with a reason — here they are not the pair.
    const skip = await t.act(owner, early, "deploy", { skipStageOrder: true, skipReason: "hotfix" });
    assert.equal(skip.json().code, "ADMIN_REQUIRED");
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);
    assert.equal((await t.act(owner, early, "deploy")).statusCode, 200);

    // A production stage that also asks for a review: the name and the backup, on the approved request.
    await call(app, admin.cookie, "PATCH", `/api/admin/environments/${t.stage("Prod")}`, { protection: "review" });
    const prod = await t.connect("prod", t.stage("Prod"));
    assert.equal(
      (await t.deployDirectly(owner, prod, { confirmName: "prod" })).json().code,
      "DEPLOYMENT_REVIEW_REQUIRED",
    );
    const toProd = await t.approved(prod);
    assert.equal((await t.act(owner, toProd, "deploy")).json().code, "PRODUCTION_CONFIRMATION_REQUIRED");
    assert.equal((await t.reviewOf(owner, toProd)).status, "approved");
    const confirmed = await t.act(deployer, toProd, "deploy", { confirmName: "prod" });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.ok(confirmed.json().backupId, "backed up first, as any production deployment");

    // Lint errors that block deployments block the request as well.
    await call(app, owner.cookie, "PUT", `${base}/lint`, { profile: "strict", blockDeployment: true });
    await t.importSchema(`${SCHEMA}Table orphans {\n  label varchar(20)\n}\n`);
    assert.equal((await t.request(owner, staging)).json().code, "LINT_BLOCKS_DEPLOYMENT");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("review: an open request is cancelled when its stage stops asking for a review or its connection leaves", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, admin, base, staging } = t;
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);

    // The stage is no longer a review stage: the request has no object, and the deployment is direct again.
    const first = await t.approved(staging);
    await t.protect("Staging", "protected");
    const cancelled = await t.reviewOf(owner, first);
    assert.deepEqual([cancelled.status, cancelled.closeReason], ["cancelled", "protection"]);
    assert.equal((await t.act(owner, first, "deploy")).json().code, "DEPLOYMENT_REVIEW_NOT_APPROVED");
    assert.equal((await notificationsOf(app, owner)).at(0)?.params.action, "cancelled");
    const audited = (await db
      .prepare("SELECT actor_email FROM audit_log WHERE action = 'connection.review.cancel' AND target_id = ?")
      .get(t.project.id)) as { actor_email: string };
    assert.equal(audited.actor_email, admin.email);
    assert.equal((await t.request(owner, staging)).json().code, "DEPLOYMENT_REVIEW_NOT_REQUIRED");
    assert.equal((await t.deployDirectly(owner, staging)).statusCode, 200);

    // Back to review, the schema moves on, and the connection is moved to another stage, then detached.
    await t.protect("Staging", "review");
    await t.importSchema(SCHEMA_2);
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);
    const second = (await t.request(owner, staging)).json().review as Review;
    await call(app, owner.cookie, "PUT", `${base}/connections/${staging}`, { environmentId: t.stage("DEV") });
    assert.deepEqual(
      [(await t.reviewOf(owner, second.id)).status, (await t.reviewOf(owner, second.id)).closeReason],
      ["cancelled", "connection"],
    );
    await call(app, owner.cookie, "PUT", `${base}/connections/${staging}`, { environmentId: t.stage("Staging") });
    const third = (await t.request(owner, staging)).json().review as Review;
    assert.equal(third.status, "pending");
    assert.equal((await call(app, owner.cookie, "DELETE", `${base}/connections/${staging}`)).statusCode, 200);
    assert.deepEqual(
      [(await t.reviewOf(owner, third.id)).status, (await t.reviewOf(owner, third.id)).closeReason],
      ["cancelled", "connection"],
    );
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("/api/v1 review: keys act as their owners — request, approve and deploy, never one's own request", async () => {
  const app = await buildApp();
  try {
    const t = await setup(app);
    const { owner, deployer, staging } = t;
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);
    const v1 = `/api/v1/projects/${t.project.id}`;
    const keyOf = async (who: Person, scopes: string[]) =>
      (await call(app, who.cookie, "POST", "/api/keys", { name: "ci", scopes })).json().plaintextKey as string;
    const ownerKey = await keyOf(owner, ["projects:read", "deployments:trigger"]);
    const deployerKey = await keyOf(deployer, ["projects:read", "deployments:trigger"]);
    const readKey = await keyOf(deployer, ["projects:read"]);
    const withKey = (key: string, method: Method, url: string, payload?: object) =>
      app.inject({
        method,
        url,
        headers: headers({ authorization: `Bearer ${key}` }),
        ...(payload ? { payload } : {}),
      });

    const direct = await withKey(ownerKey, "POST", `${v1}/connections/${staging}/deploy`, {});
    assert.deepEqual([direct.statusCode, direct.json().code], [409, "DEPLOYMENT_REVIEW_REQUIRED"]);

    const made = await withKey(ownerKey, "POST", `${v1}/connections/${staging}/reviews`, { message: "from CI" });
    assert.equal(made.statusCode, 200, made.body);
    const review = made.json().review as Review;

    // Reading takes projects:read; deciding takes deployments:trigger.
    const listed = await withKey(readKey, "GET", `${v1}/reviews`);
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.json().reviews as Review[])[0].id, review.id);
    const noScope = await withKey(readKey, "POST", `${v1}/reviews/${review.id}/approve`, {});
    assert.deepEqual([noScope.statusCode, noScope.json().code], [403, "API_SCOPE_INSUFFICIENT"]);

    // The owner's key is the owner: it cannot approve the owner's request.
    const self = await withKey(ownerKey, "POST", `${v1}/reviews/${review.id}/approve`, {});
    assert.deepEqual([self.statusCode, self.json().code], [403, "DEPLOYMENT_REVIEW_SELF_DECISION"]);

    const approval = await withKey(deployerKey, "POST", `${v1}/reviews/${review.id}/approve`, { comment: "ok" });
    assert.equal(approval.statusCode, 200, approval.body);
    const deployed = await withKey(ownerKey, "POST", `${v1}/reviews/${review.id}/deploy`, {});
    assert.equal(deployed.statusCode, 200, deployed.body);
    assert.equal(deployed.json().success, true);

    const history = (await withKey(readKey, "GET", `${v1}/connections/${staging}/history`)).json().history as {
      review?: { approvedByEmail: string };
    }[];
    assert.equal(history[0].review?.approvedByEmail, deployer.email);

    // Withdraw and reject exist there too.
    await t.importSchema(SCHEMA_2);
    assert.equal((await t.deployDirectly(owner, t.dev)).statusCode, 200);
    const again = (await withKey(ownerKey, "POST", `${v1}/connections/${staging}/reviews`, {})).json().review as Review;
    assert.equal(
      (await withKey(ownerKey, "POST", `${v1}/reviews/${again.id}/withdraw`, {})).json().review.status,
      "withdrawn",
    );
    const last = (await withKey(ownerKey, "POST", `${v1}/connections/${staging}/reviews`, {})).json().review as Review;
    assert.equal(
      (await withKey(deployerKey, "POST", `${v1}/reviews/${last.id}/reject`, {})).json().review.status,
      "rejected",
    );
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
