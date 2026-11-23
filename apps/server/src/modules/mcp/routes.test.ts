import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("mcpbundle");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { MCP_BUNDLE_PATH } = await import("./routes.js");

test("the instance hands out the single-file MCP server, as a download", async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/mcp/nebuladb-mcp.mjs",
      headers: { host: "localhost:3001" },
    });
    if (!existsSync(MCP_BUNDLE_PATH)) {
      // Not built in this checkout: a clear 404, never a 500.
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().code, "MCP_BUNDLE_MISSING");
      return;
    }
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /^text\/javascript/);
    assert.match(String(res.headers["content-disposition"]), /attachment; filename="nebuladb-mcp\.mjs"/);
    assert.ok(res.body.startsWith("#!/usr/bin/env node"), "the bundle itself");
  } finally {
    await app.close();
  }
});
