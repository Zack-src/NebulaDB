import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, ToolError, type FetchLike } from "./client.js";
import type { Config } from "./config.js";
import { capText, describeTable, diffSchemas, parseSchema, searchSchema } from "./schema.js";

export const SERVER_NAME = "nebuladb";
export const SERVER_VERSION = "1.0.0";

interface ProjectRow {
  id: string;
  name: string;
  status?: string;
  permission?: string;
}

interface Revision {
  id: string;
  author?: string | null;
  label?: string | null;
  createdAt?: string | number;
}

interface LintReport {
  profile?: string;
  blockDeployment?: boolean;
  summary?: { error: number; warning: number; info: number };
  findings?: { ruleId: string; severity: string; tableName: string; fieldName?: string; message: string }[];
}

const projectId = z.string().trim().min(1).max(200).describe("Project id, as returned by list_projects");
const enc = encodeURIComponent;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Builds the server. Nothing here writes to NebulaDB: the client only knows GET. */
export function createServer(config: Config, fetchImpl?: FetchLike): McpServer {
  const client = new ApiClient(config, fetchImpl);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const cap = (text: string) => capText(text, config.maxOutputChars);

  /** Runs a tool body; expected failures become a tool error, anything else a generic one (never a stack). */
  async function run(body: () => Promise<string>): Promise<ToolResult> {
    try {
      return { content: [{ type: "text", text: cap(await body()) }] };
    } catch (err) {
      const message = err instanceof ToolError ? err.message : "internal error while running the tool";
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const dbml = (id: string) => client.text(`/projects/${enc(id)}/export/dbml`);

  server.registerTool(
    "list_projects",
    { description: "List the NebulaDB projects the API key can see (id, name, status, permission).", annotations: readOnly },
    () =>
      run(async () => {
        const answer = await client.json<{ projects?: ProjectRow[] } | ProjectRow[]>("/projects");
        const rows = Array.isArray(answer) ? answer : (answer.projects ?? []);
        if (rows.length === 0) return "No project visible to this API key.";
        return rows.map((p) => `${p.id}\t${p.name}${p.status && p.status !== "active" ? ` [${p.status}]` : ""}${p.permission ? ` (${p.permission})` : ""}`).join("\n");
      }),
  );

  server.registerTool(
    "get_schema",
    { description: "The whole schema of a project as DBML text. Large schemas are truncated: prefer get_table or search.", inputSchema: { project_id: projectId }, annotations: readOnly },
    ({ project_id }) => run(() => dbml(project_id)),
  );

  server.registerTool(
    "get_table",
    {
      description: "One table of a project: columns (type, flags), indexes and references, as JSON.",
      inputSchema: { project_id: projectId, table: z.string().trim().min(1).max(200).describe("Table name, optionally schema-qualified") },
      annotations: readOnly,
    },
    ({ project_id, table }) => run(async () => JSON.stringify(describeTable(parseSchema(await dbml(project_id)), table), null, 2)),
  );

  server.registerTool(
    "search",
    {
      description: "Find tables and columns whose name contains the query (case-insensitive).",
      inputSchema: { project_id: projectId, query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(200).optional() },
      annotations: readOnly,
    },
    ({ project_id, query, limit }) =>
      run(async () => {
        const { hits, truncated } = searchSchema(parseSchema(await dbml(project_id)), query, limit ?? 50);
        if (hits.length === 0) return `No table or column matches "${query}".`;
        const lines = hits.map((h) => (h.kind === "table" ? `table  ${h.table}` : `column ${h.table}.${h.column} ${h.type ?? ""}`.trimEnd()));
        return lines.join("\n") + (truncated ? "\n[more results: narrow the query or raise limit]" : "");
      }),
  );

  server.registerTool(
    "get_revisions",
    {
      description: "Recent schema revisions of a project (newest first): id, date, author, label.",
      inputSchema: { project_id: projectId, limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    ({ project_id, limit }) =>
      run(async () => {
        const { revisions = [] } = await client.json<{ revisions?: Revision[] }>(`/projects/${enc(project_id)}/history`);
        if (revisions.length === 0) return "No revision recorded.";
        // The server lists oldest first.
        return revisions
          .slice(-(limit ?? 20))
          .reverse()
          .map((r) => `${r.id}\t${r.createdAt ?? ""}\t${r.author ?? "unknown"}\t${r.label ?? ""}`)
          .join("\n");
      }),
  );

  server.registerTool(
    "lint_schema",
    { description: "Findings of the server-side schema linter for a project, with the project's own rules.", inputSchema: { project_id: projectId }, annotations: readOnly },
    ({ project_id }) =>
      run(async () => {
        const report = await client.json<LintReport>(`/projects/${enc(project_id)}/lint`);
        const s = report.summary ?? { error: 0, warning: 0, info: 0 };
        const lines = (report.findings ?? []).map(
          (f) => `${f.severity.padEnd(7)} ${f.fieldName ? `${f.tableName}.${f.fieldName}` : f.tableName}: ${f.message} [${f.ruleId}]`,
        );
        lines.push(`${lines.length ? "\n" : ""}${s.error} error(s), ${s.warning} warning(s), ${s.info} info${report.profile ? ` (profile ${report.profile})` : ""}`);
        return lines.join("\n");
      }),
  );

  server.registerTool(
    "diff_schema",
    {
      description: "Compare two DBML texts locally (no server call): tables, columns and references added, removed or changed.",
      inputSchema: { before: z.string().max(2_000_000).describe("DBML source before"), after: z.string().max(2_000_000).describe("DBML source after") },
      annotations: { ...readOnly },
    },
    ({ before, after }) => run(async () => diffSchemas(before, after)),
  );

  server.registerResource(
    "project-schema",
    new ResourceTemplate("nebuladb://projects/{id}/schema", {
      list: async () => {
        try {
          const answer = await client.json<{ projects?: ProjectRow[] } | ProjectRow[]>("/projects");
          const rows = Array.isArray(answer) ? answer : (answer.projects ?? []);
          return { resources: rows.map((p) => ({ uri: `nebuladb://projects/${enc(p.id)}/schema`, name: `${p.name} (schema)`, mimeType: "text/plain" })) };
        } catch {
          return { resources: [] };
        }
      },
    }),
    { description: "DBML text of a project's schema.", mimeType: "text/plain" },
    async (uri, variables) => {
      const raw = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      let id: string;
      try {
        id = decodeURIComponent(raw ?? "");
      } catch {
        throw new ToolError("invalid project id");
      }
      if (!id || id.length > 200) throw new ToolError("invalid project id");
      let text: string;
      try {
        text = cap(await dbml(id));
      } catch (err) {
        throw new ToolError(err instanceof ToolError ? err.message : "internal error while reading the resource");
      }
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  return server;
}
