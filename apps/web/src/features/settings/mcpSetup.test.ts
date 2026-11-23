import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMcpSetup, DEFAULT_SCRIPT_PATH } from "./mcpSetup";

const KEY = "ndb_abcdefghijklmnopqrstuvwxyz0123456789";

test("Claude Code gets a claude mcp add command running the downloaded file, the key in the environment", () => {
  const { snippet, hintKey } = buildMcpSetup(
    "claudeCode",
    "https://nebula.example.com/",
    KEY,
    "~/tools/nebula mcp.mjs",
  );
  assert.equal(hintKey, "settings.aiAgent.setup.claudeCode");
  assert.match(snippet, /^claude mcp add nebuladb/);
  assert.match(snippet, /--env NEBULADB_URL=https:\/\/nebula\.example\.com \\/);
  assert.match(snippet, new RegExp(`--env NEBULADB_API_KEY=${KEY}`));
  assert.ok(snippet.endsWith('-- node ~/"tools/nebula mcp.mjs"'), "a leading ~ stays outside the quotes");
  assert.ok(
    buildMcpSetup("claudeCode", "http://x", KEY, "C:\\Users\\me\\nebuladb-mcp.mjs").snippet.endsWith(
      '-- node "C:\\Users\\me\\nebuladb-mcp.mjs"',
    ),
  );
});

test("Claude Desktop and Cursor get an mcpServers block running node on the file", () => {
  for (const client of ["claudeDesktop", "cursor"] as const) {
    const { snippet } = buildMcpSetup(client, "http://localhost:3000", KEY, "/opt/nebuladb-mcp.mjs");
    assert.deepEqual(JSON.parse(snippet).mcpServers.nebuladb, {
      command: "node",
      args: ["/opt/nebuladb-mcp.mjs"],
      env: { NEBULADB_URL: "http://localhost:3000", NEBULADB_API_KEY: KEY },
    });
  }
});

test("an empty path falls back to the suggested one", () => {
  const { snippet } = buildMcpSetup("cursor", "http://x", KEY, "  ");
  assert.deepEqual(JSON.parse(snippet).mcpServers.nebuladb.args, [DEFAULT_SCRIPT_PATH]);
});
