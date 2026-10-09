import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-alerts-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
process.env.NEBULADB_PUBLIC_URL = "https://schemas.example.test/";
// Mail is on, but goes to the test sink rather than to this (unreachable) host.
process.env.NEBULADB_SMTP_HOST = "127.0.0.1";
process.env.NEBULADB_SMTP_FROM = "NebulaDB <noreply@example.test>";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { setMailSinkForTests } = await import("../../infrastructure/mailer.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { announceDrift } = await import("./alerts.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, ...extra });

const sent: { to: string; subject: string; text: string; html: string }[] = [];
setMailSinkForTests((mail) => void sent.push(mail));

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
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

function grant(projectId: string, userId: string, permission: string): void {
  const teamId = randomUUID();
  db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
    projectId,
    teamId,
    permission,
  );
}

const mailedTo = () => sent.map((mail) => mail.to).sort();

test("alerts by email: only those who opted in, who may see the finding, and only where the instance sends mail", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const coAdmin = await login(app);
    const editor = await login(app);
    const optedOut = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    grant(project.id, coAdmin.id, "administrator");
    grant(project.id, editor.id, "edit");
    grant(project.id, optedOut.id, "edit");

    const follow = (who: { cookie: string }, emailDrift?: boolean) =>
      call(app, who.cookie, "PUT", `${base}/subscription`, {
        events: ["drift"],
        ...(emailDrift === undefined ? {} : { emailDrift }),
      });
    assert.deepEqual(
      (await follow(owner)).json().subscription,
      { events: ["drift"], emailDrift: false },
      "off by default",
    );
    assert.equal((await follow(owner, true)).json().subscription.emailDrift, true);
    assert.equal((await follow(editor, true)).statusCode, 200);
    assert.equal((await follow(coAdmin, true)).statusCode, 200);
    await follow(optedOut);
    assert.equal((await follow(owner)).json().subscription.emailDrift, true, "leaving it out keeps the choice");
    assert.equal(
      (await call(app, owner.cookie, "GET", "/api/auth/features")).json().email,
      true,
      "the web app learns that mail is on here",
    );

    // A database that changes outside Nebula: the watch records it and mails the three who asked.
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-alerts-")), "shop.sqlite");
    const connId = (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name: "Shop db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    await call(app, owner.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {});
    const target = new Database(targetFile);
    target.exec("CREATE TABLE audit_copy (id INTEGER); CREATE TABLE late (id INTEGER)");
    target.close();

    const checked = await call(app, owner.cookie, "POST", `${base}/monitoring/check`);
    assert.equal(checked.json().result.changes, 1);
    assert.deepEqual(mailedTo(), [coAdmin.email, editor.email, owner.email].sort());
    const mail = sent[0];
    assert.match(mail.subject, /Shop/);
    assert.match(mail.text, /« Shop db »/);
    assert.match(mail.text, /2 tables ajoutées \((audit_copy, late|late, audit_copy)\)/);
    assert.match(mail.text, /https:\/\/schemas\.example\.test\/project\/[0-9a-f-]+\/deployments/);
    assert.ok(mail.text.includes(`/project/${project.id}/deployments`));

    // The same state is not mailed twice.
    await call(app, owner.cookie, "POST", `${base}/monitoring/check`);
    assert.equal(sent.length, 3);

    // A mail server that refuses must not break the watch: the next finding is still recorded.
    sent.length = 0;
    setMailSinkForTests(() => Promise.reject(new Error("550 relay denied")));
    const more = new Database(targetFile);
    more.exec("CREATE TABLE even_later (id INTEGER)");
    more.close();
    const again = await call(app, owner.cookie, "POST", `${base}/monitoring/check`);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().result.changes, 1);
    assert.equal(again.json().events[0].status, "open");
    setMailSinkForTests((m) => void sent.push(m));

    // Access lost since: nothing more, by mail either.
    sent.length = 0;
    db.prepare("DELETE FROM team_members WHERE user_id = ?").run(editor.id);
    announceDrift(project.id, {
      kind: "external",
      connectionName: "Shop db",
      environment: null,
      added: ["x"],
      removed: [],
      changed: [],
    });
    assert.deepEqual(mailedTo(), [coAdmin.email, owner.email].sort());
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("alerts by email: an accounts finding is mailed to project administrators as a count, never with names", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const editor = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Vault" })).json() as {
      id: string;
    };
    const base = `/api/projects/${project.id}`;
    grant(project.id, editor.id, "edit");
    for (const who of [owner, editor]) {
      await call(app, who.cookie, "PUT", `${base}/subscription`, { events: ["drift"], emailDrift: true });
    }
    sent.length = 0;
    announceDrift(project.id, {
      kind: "accounts",
      connectionName: "Vault db",
      environment: "production",
      added: [],
      removed: [],
      changed: [],
      accountChanges: [
        { type: "created", principal: "mallory@%" },
        { type: "superuser-granted", principal: "mallory@%" },
      ],
    });
    assert.deepEqual(mailedTo(), [owner.email], "an editor is not told");
    const body = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`;
    assert.match(sent[0].text, /2 changement\(s\)/);
    assert.doesNotMatch(body, /mallory/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
