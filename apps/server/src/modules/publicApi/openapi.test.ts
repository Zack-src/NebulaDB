import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileErrors, validate } from "@readme/openapi-parser";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-openapi-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { OPERATIONS } = await import("./openapi.js");

/**
 * Keeps three descriptions of `/api/v1` from drifting apart: the routes
 * actually registered, the OpenAPI catalogue, and the hand-written tables in
 * `docs/public-api.md`. Add a route without documenting it (or the reverse)
 * and this fails.
 */

// Compiled to dist/modules/publicApi — sources and docs sit at fixed offsets from the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SOURCE_DIR = join(REPO_ROOT, "apps/server/src/modules/publicApi");
/** Routes about the API itself rather than part of it. */
const SELF_ROUTES = new Set(["GET /api/v1/openapi.json"]);

const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
const specKeys = new Set(OPERATIONS.map((op) => key(op.method, op.path)));

test("every documented operation is a registered route", async () => {
  const app = await buildApp();
  try {
    for (const op of OPERATIONS) {
      assert.ok(
        app.hasRoute({ method: op.method.toUpperCase() as "GET", url: op.path }),
        `${key(op.method, op.path)} is in openapi.ts but not registered`,
      );
    }
  } finally {
    await app.close();
  }
});

test("every /api/v1 route declared in the source is in the OpenAPI catalogue", () => {
  const declared = new Set<string>();
  for (const file of readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(join(SOURCE_DIR, file), "utf8");
    for (const m of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*"(\/api\/v1[^"]*)"/g)) {
      declared.add(key(m[1], m[2]));
    }
  }
  const undocumented = [...declared].filter((k) => !specKeys.has(k) && !SELF_ROUTES.has(k));
  assert.deepEqual(undocumented, [], "add these to OPERATIONS in openapi.ts");
  assert.ok(
    declared.size >= OPERATIONS.length,
    "the source scan found fewer routes than documented — regex out of date?",
  );
});

test("docs/public-api.md lists exactly the documented operations", () => {
  const doc = readFileSync(join(REPO_ROOT, "docs/public-api.md"), "utf8");
  const inDoc = new Set<string>();
  for (const m of doc.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `(\/api\/v1[^`?]*)/gm)) {
    inDoc.add(key(m[1], m[2]));
  }
  const missingFromDoc = [...specKeys].filter((k) => !inDoc.has(k));
  const missingFromSpec = [...inDoc].filter((k) => !specKeys.has(k) && !SELF_ROUTES.has(k));
  assert.deepEqual(missingFromDoc, [], "document these in docs/public-api.md");
  assert.deepEqual(missingFromSpec, [], "these are in docs/public-api.md but not in openapi.ts");
});

test("GET /api/v1/openapi.json is public and a valid OpenAPI 3.1 document", async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: { host: "localhost:3001" } });
    assert.equal(res.statusCode, 200, "no API key needed");
    const spec = res.json() as { openapi: string; paths: Record<string, unknown> };
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/api/v1/projects/{id}/connections/{connId}/deploy"], "Fastify `:param` becomes `{param}`");

    const result = await validate(structuredClone(spec) as never);
    assert.ok(result.valid, result.valid ? "" : compileErrors(result));
  } finally {
    await app.close();
  }
});
