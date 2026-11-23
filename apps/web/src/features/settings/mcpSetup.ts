import type { TranslationKeyOf } from "@/types";

/** The MCP clients the AI agent tab gives a ready-to-paste setup for. */
export type McpClient = "claudeCode" | "claudeDesktop" | "cursor";

export interface McpSetup {
  /** Where the snippet goes, as a translation key. */
  hintKey: TranslationKeyOf;
  snippet: string;
}

/** The package `packages/mcp` is published as; `npx` fetches and runs it. */
export const MCP_PACKAGE = "@nebuladb/mcp";

/**
 * What to paste in an MCP client to connect it to this instance with a freshly created agent key:
 * a `claude mcp add` command for Claude Code, the `mcpServers` JSON block for the others. The key
 * travels in the environment of the server the client starts, never in a URL.
 */
export function buildMcpSetup(client: McpClient, instanceUrl: string, apiKey: string): McpSetup {
  const url = instanceUrl.replace(/\/+$/, "");
  if (client === "claudeCode") {
    return {
      hintKey: "settings.aiAgent.setup.claudeCode",
      snippet: [
        "claude mcp add nebuladb \\",
        `  --env NEBULADB_URL=${url} \\`,
        `  --env NEBULADB_API_KEY=${apiKey} \\`,
        `  -- npx -y ${MCP_PACKAGE}`,
      ].join("\n"),
    };
  }
  const config = {
    mcpServers: {
      nebuladb: {
        command: "npx",
        args: ["-y", MCP_PACKAGE],
        env: { NEBULADB_URL: url, NEBULADB_API_KEY: apiKey },
      },
    },
  };
  return {
    hintKey: client === "cursor" ? "settings.aiAgent.setup.cursor" : "settings.aiAgent.setup.claudeDesktop",
    snippet: JSON.stringify(config, null, 2),
  };
}
