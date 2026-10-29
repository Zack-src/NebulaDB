import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("validation");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { parseInput, z } = await import("../../shared/validate.js");
const { ApiError } = await import("../../shared/errors.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function adminCookie(app: Awaited<ReturnType<typeof buildApp>>) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)")
    .run(randomUUID(), email, await hashPassword(password));
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: headers(), payload: { email, password } });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

test("parseInput throws VALIDATION_FAILED with field paths and never echoes values", () => {
  const schema = z.object({ password: z.string(), nested: z.object({ n: z.number() }) });
  try {
    parseInput(schema, { password: 12345678, nested: { n: "hunter2-secret" } });
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "VALIDATION_FAILED");
    assert.equal(err.status, 400);
    const fields = (err.details as { fields: { path: string }[] }).fields;
    assert.deepEqual(fields.map((f) => f.path).sort(), ["nested.n", "password"]);
    const serialised = JSON.stringify(err.toPayload());
    assert.ok(!serialised.includes("hunter2-secret"));
    assert.ok(!serialised.includes("12345678"));
  }
});

test("malformed input is a 400 VALIDATION_FAILED on login, teams and projects", async () => {
  const app = await buildApp();
  try {
    const cookie = await adminCookie(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: "a@example.com", password: { not: "a string" }, remember: "yes" },
    });
    assert.equal(login.statusCode, 400);
    assert.equal(login.json().code, "VALIDATION_FAILED");
    assert.deepEqual(login.json().fields.map((f: { path: string }) => f.path).sort(), ["password", "remember"]);

    const member = await app.inject({
      method: "POST",
      url: `/api/teams/${randomUUID()}/members`,
      headers: headers({ cookie }),
      payload: { userId: 42 },
    });
    // The team is looked up first, so an unknown team stays a 404 — validation never masks it.
    assert.equal(member.statusCode, 404);

    const team = await app.inject({ method: "POST", url: "/api/teams", headers: headers({ cookie }), payload: { name: "Ops" } });
    assert.equal(team.statusCode, 201);
    const badMember = await app.inject({
      method: "POST",
      url: `/api/teams/${team.json().id}/members`,
      headers: headers({ cookie }),
      payload: { userId: 42 },
    });
    assert.equal(badMember.statusCode, 400);
    assert.equal(badMember.json().code, "VALIDATION_FAILED");
    assert.equal(badMember.json().fields[0].path, "userId");

    // Value rules keep their dedicated codes: a non-string name is still NAME_REQUIRED.
    const badName = await app.inject({ method: "POST", url: "/api/teams", headers: headers({ cookie }), payload: { name: 7 } });
    assert.equal(badName.json().code, "NAME_REQUIRED");

    const badPaging = await app.inject({ method: "GET", url: "/api/projects?limit=1&limit=2", headers: headers({ cookie }) });
    assert.equal(badPaging.statusCode, 400);
    assert.equal(badPaging.json().code, "VALIDATION_FAILED");

    const project = await app.inject({ method: "POST", url: "/api/projects", headers: headers({ cookie }), payload: { name: "P" } });
    const badLabel = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.json().id}/revisions/whatever`,
      headers: headers({ cookie }),
      payload: { label: ["x"] },
    });
    assert.equal(badLabel.statusCode, 400);
    assert.equal(badLabel.json().fields[0].path, "label");
  } finally {
    await app.close();
  }
});
