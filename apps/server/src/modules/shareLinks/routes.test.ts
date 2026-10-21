import { test } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";
import WebSocket from "ws";

/**
 * Share links end to end: who may create and revoke them, what the token is
 * and how it is kept, when it stops working, that every way of not working
 * looks the same from outside, what the public answers hold (and must not),
 * and that the token stays out of the logs and the viewer's own session.
 */

await useTestDatabase("share-links");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
// Logged, but into `logLines` below rather than stdout: one test reads them.
process.env.NEBULADB_LOG_LEVEL = "info";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { readProjectFromDoc, writeProjectToDoc } = await import("@nebuladb/shared");
const { redactShareTokens } = await import("../../shared/logRedaction.js");

type App = Awaited<ReturnType<typeof buildApp>>;

const logLines: string[] = [];
const logStream = { write: (line: string) => void logLines.push(line) };

const HOST = "localhost:3001";
const headers = (cookie?: string) => ({ host: HOST, origin: `http://${HOST}`, ...(cookie ? { cookie } : {}) });

interface Account {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

async function makeUser(app: App, isAdmin: 0 | 1 = 0): Promise<Account> {
  const id = randomUUID();
  const password = "correct horse battery staple";
  const email = `${id}@example.com`;
  const name = `Person ${id.slice(0, 6)}`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, await hashPassword(password), isAdmin, name);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, email, name, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (
  app: App,
  cookie: string,
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) => app.inject({ method, url, headers: headers(cookie), ...(payload ? { payload } : {}) });

const SCHEMA = `Table customers {
  id int [pk, increment]
  email varchar(255) [unique, not null, note: 'Login address. [owner: jeanne.martin@corp.example] [class: personal] [tags: rgpd]']
  status customer_status
  Note: 'People who bought something. [owner: Jeanne Martin] [class: personal] [tags: core, crm]'
}

Enum customer_status {
  active [note: 'Can order']
  closed
}
`;

async function newProject(app: App, cookie: string, name = "Shop") {
  const { id } = (await call(app, cookie, "POST", "/api/projects", { name })).json() as { id: string };
  await call(app, cookie, "POST", `/api/projects/${id}/import`, { source: SCHEMA });
  return id;
}

async function enable(app: App, admin: Account, enabled = true) {
  const res = await call(app, admin.cookie, "PUT", "/api/admin/settings/share-links", { enabled });
  assert.equal(res.statusCode, 200);
}

async function createLink(app: App, owner: Account, projectId: string, body: object = { label: "For the auditors" }) {
  const res = await call(app, owner.cookie, "POST", `/api/projects/${projectId}/share-links`, body);
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { token: string; link: { id: string; tokenPrefix: string; expiresAt: string } };
}

/** A public request as a stranger makes it: no cookie, no origin. */
const view = (app: App, token: string, suffix = "") =>
  app.inject({ method: "GET", url: `/api/share/${token}${suffix}`, headers: { host: HOST } });

/** What every refusal must look like, byte for byte. */
async function assertSameRefusal(app: App, token: string, suffix = "") {
  const res = await view(app, token, suffix);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "this link does not exist or no longer works", code: "SHARE_LINK_NOT_FOUND" });
  return res;
}

test("off by default: nobody creates a link until an instance administrator turns them on, audited", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);

    const listed = await call(app, owner.cookie, "GET", `/api/projects/${projectId}/share-links`);
    assert.deepEqual(listed.json(), { enabled: false, links: [] });
    const refused = await call(app, owner.cookie, "POST", `/api/projects/${projectId}/share-links`, { label: "x" });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, "SHARE_LINKS_DISABLED");

    const notAdmin = await call(app, owner.cookie, "PUT", "/api/admin/settings/share-links", { enabled: true });
    assert.equal(notAdmin.statusCode, 403);
    const invalid = await call(app, admin.cookie, "PUT", "/api/admin/settings/share-links", { enabled: "yes" });
    assert.equal(invalid.json().code, "SHARE_LINK_SETTING_INVALID");

    await enable(app, admin);
    assert.deepEqual((await call(app, admin.cookie, "GET", "/api/admin/settings/share-links")).json(), {
      enabled: true,
    });
    const audit = (await db
      .prepare("SELECT actor_id, detail FROM audit_log WHERE action = 'instance.share_links' ORDER BY seq")
      .all()) as { actor_id: string; detail: string }[];
    assert.deepEqual(audit, [{ actor_id: admin.id, detail: "off -> on" }]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("only the project's administrators manage its links, from a session, within the limits", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const viewer = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);
    // Restricting the project to the viewer at `view` makes it theirs to read, not to share.
    await db
      .prepare("INSERT INTO project_members (project_id, user_id, permission) VALUES (?, ?, 'view')")
      .run(projectId, viewer.id);

    const forbidden = await call(app, viewer.cookie, "POST", `/api/projects/${projectId}/share-links`, { label: "x" });
    assert.equal(forbidden.statusCode, 403);
    assert.equal((await call(app, viewer.cookie, "GET", `/api/projects/${projectId}/share-links`)).statusCode, 403);

    const base = `/api/projects/${projectId}/share-links`;
    assert.equal(
      (await call(app, owner.cookie, "POST", base, { label: " " })).json().code,
      "SHARE_LINK_LABEL_REQUIRED",
    );
    assert.equal(
      (await call(app, owner.cookie, "POST", base, { label: "x", shows: "everything" })).json().code,
      "SHARE_LINK_CONTENT_INVALID",
    );
    for (const expiresInDays of [0, 366, 1.5, "30", -1]) {
      const res = await call(app, owner.cookie, "POST", base, { label: "x", expiresInDays });
      assert.equal(res.json().code, "SHARE_LINK_EXPIRY_INVALID", `expiresInDays ${String(expiresInDays)}`);
    }

    // Not with an API key, even one of the project's administrator.
    const key = await call(app, owner.cookie, "POST", "/api/keys", { name: "ci", scopes: ["projects:write"] });
    const bearer = { host: HOST, authorization: `Bearer ${key.json().plaintextKey as string}` };
    const withKey = await app.inject({ method: "POST", url: base, headers: bearer, payload: { label: "x" } });
    assert.equal(withKey.statusCode, 401);

    // Default expiry: 30 days. Maximum: one year.
    const before = Date.now();
    const { link } = await createLink(app, owner, projectId);
    const days = (Date.parse(link.expiresAt) - before) / 86_400_000;
    assert.ok(days > 29.99 && days < 30.01, `default expiry is 30 days, got ${days}`);
    const year = await createLink(app, owner, projectId, { label: "year", expiresInDays: 365 });
    assert.ok(Date.parse(year.link.expiresAt) - before < 366 * 86_400_000);

    for (let i = 0; i < 48; i++) {
      await db
        .prepare(
          `INSERT INTO share_links (id, project_id, label, token_hash, token_prefix, shows, created_at, expires_at)
         VALUES (?, ?, 'filler', ?, 'nds_filler', 'both', ?, ?)`,
        )
        .run(randomUUID(), projectId, randomUUID(), new Date().toISOString(), "2999-01-01T00:00:00.000Z");
    }
    const limited = await call(app, owner.cookie, "POST", base, { label: "one too many" });
    assert.equal(limited.statusCode, 409);
    assert.equal(limited.json().code, "SHARE_LINK_LIMIT_REACHED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("token lifecycle: shown once, stored hashed, listed by prefix, counted, revoked at once, audited", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);

    const { token, link } = await createLink(app, owner, projectId, { label: "For the auditors", shows: "both" });
    assert.match(token, /^nds_[A-Za-z0-9_-]{43}$/);
    assert.equal(link.tokenPrefix, token.slice(0, 10));

    const stored = (await db.prepare("SELECT token_hash, token_prefix FROM share_links WHERE id = ?").get(link.id)) as {
      token_hash: string;
      token_prefix: string;
    };
    assert.equal(stored.token_hash, crypto.createHash("sha256").update(token).digest("hex"));
    const raw = JSON.stringify(await db.prepare("SELECT * FROM share_links").all());
    assert.ok(!raw.includes(token), "the token itself is stored nowhere");

    const listed = await call(app, owner.cookie, "GET", `/api/projects/${projectId}/share-links`);
    assert.ok(!listed.body.includes(token), "the list never shows the token again");
    assert.ok(!listed.body.includes(stored.token_hash), "nor its hash");
    assert.equal(listed.json().links[0].tokenPrefix, token.slice(0, 10));
    assert.equal(listed.json().links[0].viewCount, 0);
    assert.equal(listed.json().links[0].createdByName, owner.name);

    assert.equal((await view(app, token)).statusCode, 200);
    assert.equal((await view(app, token, "/diagram.svg")).statusCode, 200);
    assert.equal((await view(app, token)).statusCode, 200);
    const counted = (await call(app, owner.cookie, "GET", `/api/projects/${projectId}/share-links`)).json().links[0];
    assert.equal(counted.viewCount, 2, "one view per page load, the diagram request is not counted");
    assert.ok(counted.lastViewedAt);
    assert.equal(counted.status, "active");

    // Another project's administrator cannot revoke it through their own project.
    const stranger = await makeUser(app);
    const otherProject = await newProject(app, stranger.cookie, "Other");
    const sideways = await call(app, stranger.cookie, "DELETE", `/api/projects/${otherProject}/share-links/${link.id}`);
    assert.equal(sideways.json().code, "SHARE_LINK_NOT_FOUND");

    const revoked = await call(app, owner.cookie, "DELETE", `/api/projects/${projectId}/share-links/${link.id}`);
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.json().link.status, "revoked");
    await assertSameRefusal(app, token);
    await assertSameRefusal(app, token, "/diagram.svg");
    const again = await call(app, owner.cookie, "DELETE", `/api/projects/${projectId}/share-links/${link.id}`);
    assert.equal(again.json().code, "SHARE_LINK_NOT_FOUND");

    const audit = (await db
      .prepare(
        "SELECT action, actor_id, detail, project_id FROM audit_log WHERE action LIKE 'share.%' AND project_id = ? ORDER BY seq",
      )
      .all(projectId)) as { action: string; actor_id: string; detail: string; project_id: string }[];
    assert.deepEqual(
      audit.map((row) => [row.action, row.actor_id, row.project_id]),
      [
        ["share.create", owner.id, projectId],
        ["share.revoke", owner.id, projectId],
      ],
    );
    assert.ok(audit.every((row) => row.detail.includes(token.slice(0, 10)) && !row.detail.includes(token)));
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("every way of not working answers the same: malformed, unknown, revoked, expired, trashed, switched off", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);

    await assertSameRefusal(app, "nope");
    await assertSameRefusal(app, `nds_${crypto.randomBytes(32).toString("base64url")}`);
    await assertSameRefusal(app, projectId, "/diagram.svg");

    const expired = await createLink(app, owner, projectId, { label: "expired" });
    await db
      .prepare("UPDATE share_links SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), expired.link.id);
    await assertSameRefusal(app, expired.token);
    const listed = await call(app, owner.cookie, "GET", `/api/projects/${projectId}/share-links`);
    assert.equal(listed.json().links.find((l: { id: string }) => l.id === expired.link.id).status, "expired");

    const dictionaryOnly = await createLink(app, owner, projectId, { label: "dict", shows: "dictionary" });
    assert.equal((await view(app, dictionaryOnly.token)).statusCode, 200);
    await assertSameRefusal(app, dictionaryOnly.token, "/diagram.svg");
    const diagramOnly = await createLink(app, owner, projectId, { label: "diagram", shows: "diagram" });
    assert.equal((await view(app, diagramOnly.token)).json().dictionary, null);

    // The instance switch stops every link without deleting any, and brings them back.
    await enable(app, admin, false);
    await assertSameRefusal(app, dictionaryOnly.token);
    assert.equal(
      ((await db.prepare("SELECT COUNT(*) AS n FROM share_links WHERE project_id = ?").get(projectId)) as { n: number })
        .n,
      3,
    );
    await enable(app, admin, true);
    assert.equal((await view(app, dictionaryOnly.token)).statusCode, 200);

    // In the trash, the project is not shown; restored, it is again.
    await call(app, owner.cookie, "PATCH", `/api/projects/${projectId}`, { status: "trashed" });
    await assertSameRefusal(app, dictionaryOnly.token);
    await call(app, owner.cookie, "PATCH", `/api/projects/${projectId}`, { status: "active" });
    assert.equal((await view(app, dictionaryOnly.token)).statusCode, 200);

    // Deleting the project deletes its links.
    await call(app, owner.cookie, "PATCH", `/api/projects/${projectId}`, { status: "trashed" });
    closeAllRooms();
    assert.equal((await call(app, owner.cookie, "DELETE", `/api/projects/${projectId}`)).statusCode, 200);
    assert.equal(
      ((await db.prepare("SELECT COUNT(*) AS n FROM share_links WHERE project_id = ?").get(projectId)) as { n: number })
        .n,
      0,
    );
    await assertSameRefusal(app, dictionaryOnly.token);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("the public answer: the schema as it is now, and nothing about people, comments or the instance", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);
    const { token } = await createLink(app, owner, projectId, { label: "Label only the team sees" });

    // A comment on the table, written straight into the live document.
    const room = await getRoom(projectId);
    const project = readProjectFromDoc(room.doc, projectId, "Shop");
    project.tables[0].comments = [
      {
        id: randomUUID(),
        author: owner.name,
        authorId: owner.id,
        text: "Secret remark about the migration",
        createdAt: new Date().toISOString(),
      },
    ];
    room.doc.transact(() => writeProjectToDoc(room.doc, project));

    const res = await view(app, token);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ["dictionary", "expiresAt", "projectName", "shows"]);
    assert.equal(body.projectName, "Shop");
    const [table] = body.dictionary.tables;
    assert.equal(table.name, "customers");
    assert.equal(table.description, "People who bought something.");
    assert.equal(table.classification, "personal");
    assert.deepEqual(table.tags, ["core", "crm"]);
    assert.deepEqual(Object.keys(table).sort(), ["classification", "columns", "description", "id", "name", "tags"]);
    const email = table.columns.find((c: { name: string }) => c.name === "email");
    assert.equal(email.description, "Login address.");
    assert.equal(email.classification, "personal");
    assert.ok(!("owner" in email));
    assert.deepEqual(body.dictionary.enums[0].values[0], { name: "active", description: "Can order" });

    const svg = await view(app, token, "/diagram.svg");
    assert.match(String(svg.headers["content-type"]), /^image\/svg\+xml/);
    assert.match(svg.body, /customers/);
    assert.equal(svg.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'");

    for (const leaked of [
      projectId,
      owner.id,
      owner.email,
      owner.name,
      "Jeanne Martin",
      "jeanne.martin@corp.example",
      "Secret remark",
      "Label only the team sees",
    ]) {
      assert.ok(!res.body.includes(leaked), `the JSON answer mentions ${leaked}`);
      assert.ok(!svg.body.includes(leaked), `the SVG mentions ${leaked}`);
    }

    // As it is now: an edit shows on the next view, no snapshot in between.
    await call(app, owner.cookie, "POST", `/api/projects/${projectId}/import`, {
      source: `${SCHEMA}\nTable orders {\n  id int [pk]\n}\n`,
    });
    const after = (await view(app, token)).json();
    assert.deepEqual(
      after.dictionary.tables.map((t: { name: string }) => t.name),
      ["customers", "orders"],
    );
    assert.match((await view(app, token, "/diagram.svg")).body, /orders/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("headers, no session either way, and the authenticated API stays closed to the token", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);
    const { token } = await createLink(app, owner, projectId);

    for (const res of [await view(app, token), await view(app, token, "/diagram.svg"), await view(app, "bad")]) {
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.headers["referrer-policy"], "no-referrer");
      assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
      assert.equal(res.headers["set-cookie"], undefined);
    }

    // A signed-in viewer: the cookie is neither read nor rolled forward, and the answer is the anonymous one.
    const before = (await db.prepare("SELECT expires_at FROM sessions WHERE user_id = ?").get(owner.id)) as {
      expires_at: string;
    };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const signedIn = await app.inject({
      method: "GET",
      url: `/api/share/${token}`,
      headers: headers(owner.cookie),
    });
    assert.equal(signedIn.statusCode, 200);
    assert.equal(signedIn.headers["set-cookie"], undefined);
    const afterRow = (await db.prepare("SELECT expires_at FROM sessions WHERE user_id = ?").get(owner.id)) as {
      expires_at: string;
    };
    assert.equal(afterRow.expires_at, before.expires_at, "the session was not touched");

    // The token is no credential anywhere else: not as a bearer key, not as a session cookie.
    for (const auth of [{ authorization: `Bearer ${token}` }, { cookie: `nebuladb_sid=${token}` }]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}`,
        headers: { host: HOST, ...auth },
      });
      assert.equal(res.statusCode, 401);
    }

    // Nor on the WebSocket.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    for (const auth of [{ authorization: `Bearer ${token}` }, { cookie: `nebuladb_sid=${token}` }]) {
      const status = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${projectId}`, { headers: auth });
        socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        socket.on("open", () => {
          socket.close();
          reject(new Error("the WebSocket opened with a share token"));
        });
        socket.on("error", () => {});
      });
      assert.equal(status, 401);
    }
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("an instance administrator sees and revokes every link", async () => {
  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie, "Admin view");
    await enable(app, admin);
    const { token, link } = await createLink(app, owner, projectId, { label: "admin-visible" });

    assert.equal((await call(app, owner.cookie, "GET", "/api/admin/share-links")).statusCode, 403);
    const all = (await call(app, admin.cookie, "GET", "/api/admin/share-links")).json();
    const found = all.links.find((l: { id: string }) => l.id === link.id);
    assert.equal(found.projectName, "Admin view");
    assert.ok(!JSON.stringify(all).includes(token));

    const revoked = await call(app, admin.cookie, "DELETE", `/api/admin/share-links/${link.id}`);
    assert.equal(revoked.statusCode, 200);
    await assertSameRefusal(app, token);
    const row = (await db.prepare("SELECT revoked_by FROM share_links WHERE id = ?").get(link.id)) as {
      revoked_by: string;
    };
    assert.equal(row.revoked_by, admin.id);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("public routes are rate-limited per IP", async () => {
  const app = await buildApp({ logStream });
  try {
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) {
      const res = await view(app, `nds_${crypto.randomBytes(32).toString("base64url")}`);
      if (res.statusCode === 429) limited = true;
      else assert.equal(res.statusCode, 404);
    }
    assert.ok(limited, "70 requests in a row never hit the limit");
  } finally {
    await app.close();
  }
});

test("the token never reaches the logs", async () => {
  assert.equal(redactShareTokens("/share/nds_abc?x=1"), "/share/[redacted]?x=1");
  assert.equal(redactShareTokens("/api/share/nds_abc/diagram.svg"), "/api/share/[redacted]/diagram.svg");
  assert.equal(redactShareTokens("/api/projects/abc"), "/api/projects/abc");

  const app = await buildApp({ logStream });
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const projectId = await newProject(app, owner.cookie);
    await enable(app, admin);
    const { token } = await createLink(app, owner, projectId);
    logLines.length = 0;
    await view(app, token);
    await view(app, token, "/diagram.svg");
    await app.inject({
      method: "GET",
      url: `/api/share/${token}`,
      headers: { host: HOST, referer: `http://${HOST}/share/${token}` },
    });
    const logged = logLines.join("");
    assert.match(logged, /\/api\/share\/\[redacted\]/, "the requests were logged");
    assert.ok(!logged.includes(token), "with the token taken out");
    assert.ok(!logged.includes(token.slice(4)), "all of it");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
