import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMcpSetup, MCP_PACKAGE } from "./mcpSetup";

const KEY = "ndb_abcdefghijklmnopqrstuvwxyz0123456789";

test("Claude Code gets a claude mcp add command with the instance and the key in the environment", () => {
  const { snippet, hintKey } = buildMcpSetup("claudeCode", "https://nebula.example.com/", KEY);
  assert.equal(hintKey, "settings.aiAgent.setup.claudeCode");
  assert.match(snippet, /^claude mcp add nebuladb/);
  assert.match(snippet, /--env NEBULADB_URL=https:\/\/nebula\.example\.com \\/);
  assert.match(snippet, new RegExp(`--env NEBULADB_API_KEY=${KEY}`));
  assert.ok(snippet.endsWith(`-- npx -y ${MCP_PACKAGE}`));
});

test("Claude Desktop and Cursor get an mcpServers block", () => {
  for (const client of ["claudeDesktop", "cursor"] as const) {
    const { snippet } = buildMcpSetup(client, "http://localhost:3000", KEY);
    const parsed = JSON.parse(snippet);
    assert.deepEqual(parsed.mcpServers.nebuladb, {
      command: "npx",
      args: ["-y", MCP_PACKAGE],
      env: { NEBULADB_URL: "http://localhost:3000", NEBULADB_API_KEY: KEY },
    });
  }
});
