#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, resolveConfig } from "./config.js";
import { createServer } from "./server.js";

// stdout carries the protocol: everything human-readable goes to stderr, and never the key.
try {
  const server = createServer(resolveConfig(process.env));
  await server.connect(new StdioServerTransport());
} catch (err) {
  process.stderr.write(`nebuladb-mcp: ${err instanceof ConfigError ? err.message : "failed to start"}\n`);
  process.exitCode = 1;
}
