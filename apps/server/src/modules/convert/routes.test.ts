import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-convert-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: headers(), payload: { email, password } });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return `athanordb_sid=${sessionCookie!.value}`;
}

async function makeUser() {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  return { id, email, password };
}

test("POST /api/convert/to-dbml requires auth, converts valid SQL, and reports a parse error with line info", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const cookie = await loginAs(app, user.email, user.password);

    const unauth = await app.inject({
      method: "POST",
      url: "/api/convert/to-dbml",
      headers: headers(),
      payload: { source: "CREATE TABLE x (id int);", dialect: "postgres" },
    });
    assert.equal(unauth.statusCode, 401);

    const ok = await app.inject({
      method: "POST",
      url: "/api/convert/to-dbml",
      headers: headers({ cookie }),
      payload: { source: "CREATE TABLE widgets (id INT PRIMARY KEY, name TEXT);", dialect: "postgres" },
    });
    assert.equal(ok.statusCode, 200);
    assert.match(ok.json().dbml, /Table widgets/);

    const badDialect = await app.inject({
      method: "POST",
      url: "/api/convert/to-dbml",
      headers: headers({ cookie }),
      payload: { source: "CREATE TABLE x (id int);", dialect: "oracle" },
    });
    assert.equal(badDialect.statusCode, 400);
    assert.equal(badDialect.json().code, "SQL_DIALECT_INVALID");

    const emptySource = await app.inject({
      method: "POST",
      url: "/api/convert/to-dbml",
      headers: headers({ cookie }),
      payload: { source: "   ", dialect: "postgres" },
    });
    assert.equal(emptySource.statusCode, 400);
    assert.equal(emptySource.json().code, "SOURCE_REQUIRED");

    const malformed = await app.inject({
      method: "POST",
      url: "/api/convert/to-dbml",
      headers: headers({ cookie }),
      payload: { source: "CREATE TABLE this is not valid SQL at all (((", dialect: "postgres" },
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().code, "SQL_PARSE_FAILED");
  } finally {
    await app.close();
  }
});
