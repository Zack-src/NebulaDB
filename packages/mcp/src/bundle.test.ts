import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * `dist/nebuladb-mcp.mjs` is what an instance hands out to connect an agent (Settings → AI agent):
 * it must run on its own. Copied into an empty folder — no `node_modules` to fall back on — it
 * starts and lists its tools.
 */

const BUNDLE = fileURLToPath(new URL("./nebuladb-mcp.mjs", import.meta.url));

test("the single-file MCP server runs with no dependency installed", { skip: !existsSync(BUNDLE) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-mcp-"));
  try {
    const script = join(dir, "nebuladb-mcp.mjs");
    copyFileSync(BUNDLE, script);
    const child = spawn(process.execPath, [script], {
      cwd: dir,
      env: { ...process.env, NEBULADB_URL: "http://localhost:9", NEBULADB_API_KEY: "ndb_test" },
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const tools = await new Promise<string[]>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`no answer: ${buffer.slice(0, 500)}`)), 20_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split("\n")) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { id?: number; result?: { tools?: { name: string }[] } };
          if (message.id === 1) {
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
          }
          if (message.id === 2) {
            clearTimeout(timer);
            resolve((message.result?.tools ?? []).map((t) => t.name));
          }
        }
        buffer = buffer.endsWith("\n") ? "" : (buffer.split("\n").pop() ?? "");
      });
      child.on("error", reject);
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      });
    });
    // Windows keeps the folder locked while the process lives.
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
    assert.ok(tools.includes("get_schema") && tools.includes("run_sql"), tools.join(", "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
