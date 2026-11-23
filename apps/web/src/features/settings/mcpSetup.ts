import type { TranslationKeyOf } from "@/types";

/** The MCP clients the AI agent tab gives a ready-to-paste setup for. */
export type McpClient = "claudeCode" | "claudeDesktop" | "cursor";

export interface McpSetup {
  /** Where the snippet goes, as a translation key. */
  hintKey: TranslationKeyOf;
  snippet: string;
}

/**
 * Where the instance serves the MCP server as one file (`apps/server/src/modules/mcp/routes.ts`):
 * Node 22+ runs it with nothing installed, so it works whether or not `@nebuladb/mcp` is on npm.
 */
export const MCP_DOWNLOAD_PATH = "/api/mcp/nebuladb-mcp.mjs";

/** Where the tab suggests saving it; the person changes it to their own path. */
export const DEFAULT_SCRIPT_PATH = "~/nebuladb-mcp.mjs";

/**
 * What to paste in an MCP client to connect it to this instance with a freshly created agent key,
 * running the downloaded file at `scriptPath`: a `claude mcp add` command for Claude Code, the
 * `mcpServers` JSON block for the others. The key travels in the environment of the server the
 * client starts, never in a URL.
 */
export function buildMcpSetup(client: McpClient, instanceUrl: string, apiKey: string, scriptPath: string): McpSetup {
  const url = instanceUrl.replace(/\/+$/, "");
  const script = scriptPath.trim() || DEFAULT_SCRIPT_PATH;
  if (client === "claudeCode") {
    // Quoted for the shell, except a leading `~/`, which the shell must expand.
    const quoted = script.startsWith("~/") ? `~/"${script.slice(2)}"` : `"${script}"`;
    return {
      hintKey: "settings.aiAgent.setup.claudeCode",
      snippet: [
        "claude mcp add nebuladb \\",
        `  --env NEBULADB_URL=${url} \\`,
        `  --env NEBULADB_API_KEY=${apiKey} \\`,
        `  -- node ${quoted}`,
      ].join("\n"),
    };
  }
  const config = {
    mcpServers: {
      nebuladb: {
        command: "node",
        args: [script],
        env: { NEBULADB_URL: url, NEBULADB_API_KEY: apiKey },
      },
    },
  };
  return {
    hintKey: client === "cursor" ? "settings.aiAgent.setup.cursor" : "settings.aiAgent.setup.claudeDesktop",
    snippet: JSON.stringify(config, null, 2),
  };
}
