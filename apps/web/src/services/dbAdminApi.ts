import type {
  AdminConnectionSummary,
  DatabaseConnectionConfig,
  DbAdminCapabilities,
  DbAdminDatabase,
  DbAdminObjectRef,
  DbAdminQueryHistoryEntry,
  DbAdminQueryResult,
  DbAdminSchema,
  DbAdminSession,
  DbAdminStatementsResult,
  DbAdminTable,
  DbAdminTableDescription,
  DbConsoleAccess,
  DbGrant,
  DbPrincipal,
  DbPrincipalRef,
  DbPrivilegeCatalog,
  DbUserAction,
  EffectiveStructurePolicy,
  StructurePolicySetting,
  PersonalCredentialHolder,
} from "@athanordb/shared";
import type { TestConnectionResponse } from "./connectionsApi";
import { request } from "./httpClient";

/** What the admin console sends to create or update a connection. */
export type AdminConnectionInput = Partial<Omit<DatabaseConnectionConfig, "id" | "projectId">>;

export interface ConnectionOverview {
  /**
   * `admin`: an instance administrator, the whole console. `read` / `write`:
   * a member granted this connection — the explorer and SQL only, and for
   * `write` data statements each confirmed (`confirmWrite`).
   */
  access: DbConsoleAccess;
  capabilities: DbAdminCapabilities;
  privileges: DbPrivilegeCatalog;
  readOnly: boolean;
  /** What the console does with table / index changes on this connection — see `StructurePolicy`. */
  structurePolicy: EffectiveStructurePolicy;
  defaultDatabase: string | null;
  databases: DbAdminDatabase[];
}

export type DropKind = "database" | "table" | "view" | "column";

const base = (id: string) => `/api/admin/connections/${id}`;
/**
 * The explorer and SQL routes that also serve members granted the connection
 * (the server checks the grant on every call); instance administrators keep
 * the console's full rights on them.
 */
const consoleBase = (id: string) => `/api/connections/${id}`;

// ---- Connections -----------------------------------------------------------

export async function listAdminConnections(): Promise<AdminConnectionSummary[]> {
  return (await request<{ connections: AdminConnectionSummary[] }>("/api/admin/connections")).connections;
}

export async function createAdminConnection(config: AdminConnectionInput): Promise<AdminConnectionSummary> {
  return (
    await request<{ connection: AdminConnectionSummary }>("/api/admin/connections", { method: "POST", body: config })
  ).connection;
}

export async function updateAdminConnection(
  id: string,
  updates: AdminConnectionInput,
): Promise<AdminConnectionSummary> {
  return (await request<{ connection: AdminConnectionSummary }>(base(id), { method: "PUT", body: updates })).connection;
}

/** `force` deletes a connection that projects still use — the server refuses otherwise (`CONNECTION_IN_USE`). */
export async function deleteAdminConnection(id: string, force: boolean): Promise<void> {
  await request<void>(base(id), { method: "DELETE", query: { force: force ? "true" : undefined } });
}

export async function setAdminConnectionProjects(id: string, projectIds: string[]): Promise<AdminConnectionSummary> {
  return (
    await request<{ connection: AdminConnectionSummary }>(`${base(id)}/projects`, {
      method: "PUT",
      body: { projectIds },
    })
  ).connection;
}

/** `id` lets the server fall back to the stored password when the form's is empty (editing an existing connection). */
export function testAdminConnection(config: AdminConnectionInput, id?: string): Promise<TestConnectionResponse> {
  return request<TestConnectionResponse>("/api/admin/connections/test", { method: "POST", body: { ...config, id } });
}

/** Who has given their own account on a connection — names, never passwords. */
export async function fetchCredentialHolders(id: string): Promise<PersonalCredentialHolder[]> {
  return (await request<{ holders: PersonalCredentialHolder[] }>(`${base(id)}/credentials`)).holders;
}

export async function checkAdminConnectionHealth(id: string): Promise<AdminConnectionSummary> {
  return (await request<{ connection: AdminConnectionSummary }>(`${base(id)}/health`, { method: "POST", body: {} }))
    .connection;
}

// ---- Structure policy ------------------------------------------------------

export async function fetchInstanceStructurePolicy(): Promise<StructurePolicySetting> {
  return (await request<{ setting: StructurePolicySetting }>("/api/admin/settings/structure-policy")).setting;
}

export async function saveInstanceStructurePolicy(setting: StructurePolicySetting): Promise<StructurePolicySetting> {
  return (
    await request<{ setting: StructurePolicySetting }>("/api/admin/settings/structure-policy", {
      method: "PUT",
      body: setting,
    })
  ).setting;
}

// ---- Explorer --------------------------------------------------------------

export function fetchConnectionOverview(id: string): Promise<ConnectionOverview> {
  return request<ConnectionOverview>(`${consoleBase(id)}/overview`);
}

export async function fetchSchemas(id: string, database?: string): Promise<DbAdminSchema[]> {
  return (await request<{ schemas: DbAdminSchema[] }>(`${consoleBase(id)}/schemas`, { query: { database } })).schemas;
}

export async function fetchTables(id: string, database?: string, schema?: string): Promise<DbAdminTable[]> {
  return (await request<{ tables: DbAdminTable[] }>(`${consoleBase(id)}/tables`, { query: { database, schema } }))
    .tables;
}

export async function fetchTableDescription(id: string, ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
  return (await request<{ description: DbAdminTableDescription }>(`${consoleBase(id)}/table`, { query: { ...ref } }))
    .description;
}

export async function fetchTableRows(
  id: string,
  ref: DbAdminObjectRef,
  limit: number,
  offset: number,
): Promise<DbAdminQueryResult> {
  return (
    await request<{ result: DbAdminQueryResult }>(`${consoleBase(id)}/rows`, { query: { ...ref, limit, offset } })
  ).result;
}

// ---- SQL console -----------------------------------------------------------

export async function runAdminQuery(
  id: string,
  sql: string,
  /** `confirmStructural`: the user accepted running table / index DDL outside the schema (policy `warn`). */
  /** `confirmWrite`: the user confirmed this write — required by the server from a member with `write` access. */
  options: {
    database?: string;
    readOnly: boolean;
    editor?: boolean;
    maxRows?: number;
    confirmStructural?: boolean;
    confirmWrite?: boolean;
  },
): Promise<DbAdminQueryResult> {
  return (
    await request<{ result: DbAdminQueryResult }>(`${consoleBase(id)}/query`, {
      method: "POST",
      body: { sql, ...options },
    })
  ).result;
}

export async function fetchQueryHistory(id: string): Promise<DbAdminQueryHistoryEntry[]> {
  return (await request<{ history: DbAdminQueryHistoryEntry[] }>(`${consoleBase(id)}/query-history`)).history;
}

// ---- Mutations: every one previews (`execute: false`) before it runs --------

export function dropObject(
  id: string,
  kind: DropKind,
  ref: DbAdminObjectRef,
  execute: boolean,
  confirm?: string,
): Promise<DbAdminStatementsResult> {
  return request<DbAdminStatementsResult>(`${base(id)}/drop`, {
    method: "POST",
    body: { kind, ref, execute, confirm },
  });
}

export async function fetchPrincipals(id: string, database?: string): Promise<DbPrincipal[]> {
  return (await request<{ principals: DbPrincipal[] }>(`${base(id)}/principals`, { query: { database } })).principals;
}

export async function fetchGrants(id: string, principal: DbPrincipalRef): Promise<DbGrant[]> {
  return (await request<{ grants: DbGrant[] }>(`${base(id)}/grants`, { query: { ...principal } })).grants;
}

export function applyUserAction(id: string, action: DbUserAction, execute: boolean): Promise<DbAdminStatementsResult> {
  return request<DbAdminStatementsResult>(`${base(id)}/users`, { method: "POST", body: { action, execute } });
}

export async function fetchSessions(id: string): Promise<DbAdminSession[]> {
  return (await request<{ sessions: DbAdminSession[] }>(`${base(id)}/sessions`)).sessions;
}

export function killSession(id: string, sessionId: string, execute: boolean): Promise<DbAdminStatementsResult> {
  return request<DbAdminStatementsResult>(`${base(id)}/sessions/kill`, {
    method: "POST",
    body: { sessionId, execute },
  });
}
