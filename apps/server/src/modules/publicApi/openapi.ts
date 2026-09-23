import { ERROR_CATALOG } from "../../shared/errors.js";
import type { ApiKeyScope } from "../apiKeys/repository.js";

/**
 * OpenAPI 3.1 description of `/api/v1`, served at `GET /api/v1/openapi.json`.
 *
 * Written as a compact operation catalogue rather than Fastify route schemas:
 * the routes carry no JSON schemas today, and adding validation schemas to
 * every one would change request handling, not just documentation. Drift is
 * prevented by test instead — `openapi.test.ts` fails if a registered
 * `/api/v1` route is missing here (or documented here but not registered),
 * and if `docs/public-api.md`'s tables disagree with this catalogue.
 */

type Method = "get" | "post" | "put" | "patch" | "delete";
type Schema = Record<string, unknown>;

interface Operation {
  method: Method;
  /** Fastify syntax (`:id`) — converted to OpenAPI's `{id}` below. */
  path: string;
  tag: "Projects" | "Connections" | "Teams";
  scope: ApiKeyScope;
  /** Also needs project `administrator` (or global admin for teams) — a scope alone isn't enough. */
  admin?: boolean;
  summary: string;
  description?: string;
  query?: { name: string; schema: Schema; description?: string; required?: boolean }[];
  body?: Schema;
  /** Success response: a JSON schema, or a non-JSON media type. */
  ok: { status: 200 | 201; schema?: Schema; mediaType?: string };
}

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
});
const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const flag = (name: string): Schema => obj({ [name]: { type: "boolean", const: true } });
const PERMISSION: Schema = { type: "string", enum: ["view", "edit", "administrator"] };
const DIALECT: Schema = { type: "string", enum: ["postgres", "mysql", "mssql"] };

export const OPERATIONS: Operation[] = [
  // --- projects ---
  {
    method: "get",
    path: "/api/v1/projects",
    tag: "Projects",
    scope: "projects:read",
    summary: "List every project the caller can see",
    ok: { status: 200, schema: obj({ projects: { type: "array", items: ref("ProjectSummary") } }) },
  },
  {
    method: "post",
    path: "/api/v1/projects",
    tag: "Projects",
    scope: "projects:write",
    summary: "Create a project, empty or from a starter template",
    body: obj(
      {
        name: { type: "string", maxLength: 200 },
        template: { type: "string", enum: ["blog", "ecommerce", "saas", "auth"] },
      },
      ["name"],
    ),
    ok: { status: 201, schema: obj({ id: str, name: str, permission: PERMISSION }) },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id",
    tag: "Projects",
    scope: "projects:read",
    summary: "Read one project",
    ok: { status: 200, schema: obj({ id: str, name: str, permission: PERMISSION }) },
  },
  {
    method: "patch",
    path: "/api/v1/projects/:id",
    tag: "Projects",
    scope: "projects:write",
    admin: true,
    summary: "Rename and/or archive, trash or restore",
    body: obj({ name: str, status: { type: "string", enum: ["active", "archived", "trashed"] } }, []),
    ok: { status: 200, schema: ref("ProjectSummary") },
  },
  {
    method: "delete",
    path: "/api/v1/projects/:id",
    tag: "Projects",
    scope: "projects:write",
    admin: true,
    summary: "Delete permanently (irreversible)",
    ok: { status: 200, schema: flag("deleted") },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/history",
    tag: "Projects",
    scope: "projects:read",
    summary: "Schema revision log",
    ok: { status: 200, schema: obj({ revisions: { type: "array", items: ref("Revision") } }) },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/iam",
    tag: "Projects",
    scope: "projects:read",
    summary: "Teams granted access, with their permission",
    ok: {
      status: 200,
      schema: obj({
        teams: { type: "array", items: obj({ teamId: str, teamName: str, permission: PERMISSION }) },
      }),
    },
  },
  {
    method: "put",
    path: "/api/v1/projects/:id/iam/:teamId",
    tag: "Projects",
    scope: "projects:write",
    admin: true,
    summary: "Grant or change a team's access",
    body: obj({ permission: PERMISSION }),
    ok: { status: 200, schema: obj({ projectId: str, teamId: str, permission: PERMISSION }) },
  },
  {
    method: "delete",
    path: "/api/v1/projects/:id/iam/:teamId",
    tag: "Projects",
    scope: "projects:write",
    admin: true,
    summary: "Revoke a team's access",
    ok: { status: 200, schema: flag("removed") },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/export/dbml",
    tag: "Projects",
    scope: "projects:read",
    summary: "Export as DBML",
    query: [
      {
        name: "visual",
        schema: { type: "string", enum: ["1"] },
        description: "Include the position/style sidecar, so a re-import is lossless",
      },
    ],
    ok: { status: 200, mediaType: "text/plain" },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/export/sql",
    tag: "Projects",
    scope: "projects:read",
    summary: "Export as SQL DDL",
    query: [{ name: "dialect", schema: DIALECT, required: true }],
    ok: { status: 200, mediaType: "text/plain" },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/export/svg",
    tag: "Projects",
    scope: "projects:read",
    summary: "Server-rendered diagram (SVG)",
    ok: { status: 200, mediaType: "image/svg+xml" },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/export/png",
    tag: "Projects",
    scope: "projects:read",
    summary: "Server-rendered diagram (PNG)",
    ok: { status: 200, mediaType: "image/png" },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/import",
    tag: "Projects",
    scope: "projects:write",
    summary: "Import DBML or SQL into the project",
    description:
      "Merged by table/field name, so existing positions and styles survive. Pass `baseline` (the text your source was derived from) for the same three-way merge the web editor uses, which keeps whatever a collaborator added meanwhile.",
    body: obj({ source: str, dialect: DIALECT, baseline: str }, ["source"]),
    ok: { status: 200, schema: obj({ imported: { type: "boolean", const: true }, tables: int }) },
  },

  // --- connections ---
  {
    method: "get",
    path: "/api/v1/projects/:id/connections",
    tag: "Connections",
    scope: "projects:read",
    summary: "List the project's database connections (credentials never returned)",
    ok: { status: 200, schema: obj({ connections: { type: "array", items: ref("Connection") } }) },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/connections",
    tag: "Connections",
    scope: "connections:manage",
    admin: true,
    summary: "Create a connection",
    body: ref("ConnectionInput"),
    ok: { status: 200, schema: obj({ connection: ref("Connection") }) },
  },
  {
    method: "put",
    path: "/api/v1/projects/:id/connections/:connId",
    tag: "Connections",
    scope: "connections:manage",
    admin: true,
    summary: "Update a connection (an omitted password is kept)",
    body: ref("ConnectionInput"),
    ok: { status: 200, schema: obj({ connection: ref("Connection") }) },
  },
  {
    method: "delete",
    path: "/api/v1/projects/:id/connections/:connId",
    tag: "Connections",
    scope: "connections:manage",
    admin: true,
    summary: "Delete a connection",
    ok: { status: 200, schema: flag("deleted") },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/connections/test",
    tag: "Connections",
    scope: "connections:manage",
    admin: true,
    summary: "Test a connection config without saving it",
    body: ref("ConnectionInput"),
    ok: {
      status: 200,
      schema: obj({ ok: bool, version: str, database: str, error: str }, ["ok"]),
    },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/connections/:connId/pull",
    tag: "Connections",
    scope: "connections:manage",
    admin: true,
    summary: "Introspect the live database onto the canvas",
    ok: { status: 200, schema: obj({ pulled: { type: "boolean", const: true }, tablesCount: int }) },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/connections/:connId/deploy",
    tag: "Connections",
    scope: "deployments:trigger",
    admin: true,
    summary: "Deploy the canvas schema to the live database",
    description:
      "Introspect → diff → generate SQL → execute → record, the same pipeline as the web app's deploy button. `resolutions` answers the risks a plan reported (e.g. a default value for a new NOT NULL column).",
    body: obj({ resolutions: { type: "object", additionalProperties: true } }, []),
    ok: {
      status: 200,
      schema: obj({
        success: bool,
        executedStatements: int,
        sql: str,
        rollbackAvailable: bool,
        irreversibleWarnings: { type: "array", items: str },
      }),
    },
  },
  {
    method: "get",
    path: "/api/v1/projects/:id/connections/:connId/history",
    tag: "Connections",
    scope: "projects:read",
    admin: true,
    summary: "Deployment history of a connection",
    ok: { status: 200, schema: obj({ history: { type: "array", items: ref("DeploymentHistoryEntry") } }) },
  },
  {
    method: "post",
    path: "/api/v1/projects/:id/connections/:connId/history/:historyId/rollback",
    tag: "Connections",
    scope: "deployments:trigger",
    admin: true,
    summary: "Roll back a past deployment",
    ok: { status: 200, schema: obj({ success: bool, executedStatements: int }) },
  },

  // --- teams ---
  {
    method: "get",
    path: "/api/v1/teams",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "List teams",
    ok: {
      status: 200,
      schema: obj({ teams: { type: "array", items: obj({ id: str, name: str, createdAt: str, memberCount: int }) } }),
    },
  },
  {
    method: "get",
    path: "/api/v1/teams/:id",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Team detail with members",
    ok: {
      status: 200,
      schema: obj({ id: str, name: str, createdAt: str, members: { type: "array", items: ref("TeamMember") } }),
    },
  },
  {
    method: "post",
    path: "/api/v1/teams",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Create a team",
    body: obj({ name: str }),
    ok: { status: 201, schema: obj({ id: str, name: str, memberCount: int }) },
  },
  {
    method: "patch",
    path: "/api/v1/teams/:id",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Rename a team",
    body: obj({ name: str }),
    ok: { status: 200, schema: obj({ id: str, name: str }) },
  },
  {
    method: "delete",
    path: "/api/v1/teams/:id",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Delete a team (drops its project grants)",
    ok: { status: 200, schema: flag("deleted") },
  },
  {
    method: "post",
    path: "/api/v1/teams/:id/members",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Add a member",
    body: obj({ userId: str }),
    ok: { status: 200, schema: flag("added") },
  },
  {
    method: "delete",
    path: "/api/v1/teams/:id/members/:userId",
    tag: "Teams",
    scope: "teams:manage",
    admin: true,
    summary: "Remove a member",
    ok: { status: 200, schema: flag("removed") },
  },
];

const COMPONENTS: Record<string, Schema> = {
  Error: {
    type: "object",
    description: "Every error response. `code` is the stable contract; `error` is an English message that may change.",
    properties: {
      error: str,
      code: { type: "string", enum: Object.keys(ERROR_CATALOG) },
    },
    required: ["error", "code"],
    additionalProperties: true,
  },
  ProjectSummary: obj({
    id: str,
    name: str,
    status: { type: "string", enum: ["active", "archived", "trashed"] },
    created_at: str,
    permission: PERMISSION,
  }),
  Revision: obj({ id: str, author: str, label: { type: ["string", "null"] }, createdAt: str }),
  Connection: obj(
    {
      id: str,
      projectId: str,
      name: str,
      engine: ref("Engine"),
      environment: str,
      host: str,
      port: int,
      database: str,
      user: str,
      hasPassword: bool,
      ssl: bool,
      connectionString: { type: "string", description: "Password masked as `***`" },
      filePath: str,
      createdAt: str,
      updatedAt: str,
    },
    ["id", "projectId", "name", "engine", "hasPassword", "createdAt", "updatedAt"],
  ),
  ConnectionInput: obj(
    {
      name: str,
      engine: ref("Engine"),
      environment: str,
      host: str,
      port: int,
      database: str,
      user: str,
      password: { type: "string", writeOnly: true },
      ssl: bool,
      connectionString: str,
      filePath: str,
    },
    ["engine"],
  ),
  Engine: { type: "string", enum: ["postgres", "mysql", "sqlite", "mssql", "oracle"] },
  DeploymentHistoryEntry: obj(
    {
      id: str,
      projectId: str,
      connectionId: { type: ["string", "null"] },
      connectionName: str,
      environment: str,
      engine: ref("Engine"),
      sql: str,
      rollbackSql: { type: ["string", "null"] },
      rollbackOf: { type: ["string", "null"] },
      success: bool,
      executedStatements: int,
      totalStatements: int,
      error: str,
      executedByEmail: { type: ["string", "null"] },
      createdAt: str,
      rolledBack: bool,
    },
    ["id", "projectId", "connectionName", "engine", "sql", "success", "createdAt", "rolledBack"],
  ),
  TeamMember: obj({ id: str, email: str, isAdmin: bool, displayName: str }),
};

const ERROR_RESPONSES = {
  "400": "Invalid input",
  "401": "Missing, invalid or revoked API key",
  "403": "Scope insufficient, key restricted to another project, or not enough permission on the project",
  "404": "Not found",
  "429": "Rate limited",
};

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

export function buildOpenApiSpec(serverUrl: string | null): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const pathParams = [...op.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: str,
    }));
    const queryParams = (op.query ?? []).map((q) => ({
      name: q.name,
      in: "query",
      required: q.required ?? false,
      schema: q.schema,
      ...(q.description ? { description: q.description } : {}),
    }));
    const okContent = op.ok.mediaType
      ? {
          [op.ok.mediaType]: {
            schema: op.ok.mediaType.startsWith("image/png") ? { type: "string", format: "binary" } : str,
          },
        }
      : { "application/json": { schema: op.ok.schema } };
    const permissionNote = op.admin
      ? op.tag === "Teams"
        ? "Requires a global administrator."
        : "Requires project `administrator`, not just the scope."
      : undefined;
    paths[toOpenApiPath(op.path)] ??= {};
    paths[toOpenApiPath(op.path)][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.description || permissionNote
        ? { description: [op.description, permissionNote].filter(Boolean).join("\n\n") }
        : {}),
      operationId: `${op.method}${toOpenApiPath(op.path)
        .replace(/^\/api\/v1/, "")
        .replace(/[{}]/g, "")
        .split(/[/-]/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("")}`,
      "x-athanordb-scope": op.scope,
      security: [{ apiKey: [op.scope] }],
      ...(pathParams.length + queryParams.length > 0 ? { parameters: [...pathParams, ...queryParams] } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: op.body } } } } : {}),
      responses: {
        [String(op.ok.status)]: { description: "Success", content: okContent },
        ...Object.fromEntries(
          Object.entries(ERROR_RESPONSES).map(([status, description]) => [
            status,
            { description, content: { "application/json": { schema: ref("Error") } } },
          ]),
        ),
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "AthanorDB public API",
      version: "1",
      description:
        "Stable REST surface for scripts and CI. Authenticate with `Authorization: Bearer adb_…` (create keys in Settings). A key acts as its owner, narrowed by its scopes and optional project restriction. See docs/public-api.md.",
    },
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
    tags: [{ name: "Projects" }, { name: "Connections" }, { name: "Teams" }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "adb_…" } },
      schemas: COMPONENTS,
    },
    security: [{ apiKey: [] }],
    paths,
  };
}
