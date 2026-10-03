import type {
  DatabaseConnectionConfig,
  DatabaseConnectionSummary,
  DeploymentHistoryEntry,
  DriftCheckResult,
  MigrationResolutionMap,
  ProjectDriftEntry,
  SchemaRisk,
} from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import { request } from "./httpClient";

export interface TestConnectionResponse {
  ok: boolean;
  version?: string;
  database?: string;
  error?: string;
}

export interface PlanDeploymentResponse {
  diff: MigrationDiff;
  risks: SchemaRisk[];
  sqlPreview: string;
  engine: string;
}

export interface ApplyDeploymentResponse {
  success: boolean;
  executedStatements: number;
  sql: string;
  rollbackAvailable: boolean;
  irreversibleWarnings: string[];
}

export interface RollbackResponse {
  success: boolean;
  executedStatements: number;
}

export interface CreateProjectFromDatabaseResponse {
  id: string;
  name: string;
  connectionId: string;
  tablesCount: number;
}

/** Creates a brand-new project from a live database's introspected schema — see `/api/projects/from-database`. */
export async function createProjectFromDatabase(
  projectName: string,
  config: Omit<DatabaseConnectionConfig, "id" | "projectId">,
): Promise<CreateProjectFromDatabaseResponse> {
  return request<CreateProjectFromDatabaseResponse>("/api/projects/from-database", {
    method: "POST",
    // `projectName` is a distinct field from `config.name` (the connection's
    // own name) on purpose — spreading `config` after a shared `name` key
    // would have let the connection's name silently overwrite the project's.
    body: { projectName, ...config },
  });
}

export async function listProjectConnections(projectId: string): Promise<DatabaseConnectionSummary[]> {
  const res = await request<{ connections: DatabaseConnectionSummary[] }>(`/api/projects/${projectId}/connections`);
  return res.connections;
}

export async function createProjectConnection(
  projectId: string,
  config: Omit<DatabaseConnectionConfig, "id">,
): Promise<DatabaseConnectionSummary> {
  const res = await request<{ connection: DatabaseConnectionSummary }>(`/api/projects/${projectId}/connections`, {
    method: "POST",
    body: config,
  });
  return res.connection;
}

export async function updateProjectConnection(
  projectId: string,
  connId: string,
  updates: Partial<DatabaseConnectionConfig>,
): Promise<DatabaseConnectionSummary> {
  const res = await request<{ connection: DatabaseConnectionSummary }>(
    `/api/projects/${projectId}/connections/${connId}`,
    { method: "PUT", body: updates },
  );
  return res.connection;
}

export async function deleteProjectConnection(projectId: string, connId: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/connections/${connId}`, { method: "DELETE" });
}

export async function testConnectionConfig(
  projectId: string,
  config: Partial<DatabaseConnectionConfig>,
): Promise<TestConnectionResponse> {
  return request<TestConnectionResponse>(`/api/projects/${projectId}/connections/test`, {
    method: "POST",
    body: config,
  });
}

export async function pullDatabaseSchema(
  projectId: string,
  connId: string,
): Promise<{ pulled: boolean; tablesCount: number }> {
  return request<{ pulled: boolean; tablesCount: number }>(`/api/projects/${projectId}/connections/${connId}/pull`, {
    method: "POST",
    body: {},
  });
}

export async function planDeployment(projectId: string, connId: string): Promise<PlanDeploymentResponse> {
  return request<PlanDeploymentResponse>(`/api/projects/${projectId}/connections/${connId}/plan-deployment`, {
    method: "POST",
    body: {},
  });
}

export async function applyDeployment(
  projectId: string,
  connId: string,
  resolutions: MigrationResolutionMap,
  options: {
    /** The connection's name, retyped — the server requires it for the production stage. */
    confirmName?: string;
    /** Why the plan's risks are accepted; kept with the deployment. */
    riskNote?: string;
  } = {},
): Promise<ApplyDeploymentResponse> {
  return request<ApplyDeploymentResponse>(`/api/projects/${projectId}/connections/${connId}/apply-deployment`, {
    method: "POST",
    body: { resolutions, ...options },
  });
}

export async function listDeploymentHistory(projectId: string, connId: string): Promise<DeploymentHistoryEntry[]> {
  const res = await request<{ history: DeploymentHistoryEntry[] }>(
    `/api/projects/${projectId}/connections/${connId}/history`,
  );
  return res.history;
}

export async function rollbackDeployment(
  projectId: string,
  connId: string,
  historyId: string,
  /** As for `applyDeployment`. */
  confirmName?: string,
): Promise<RollbackResponse> {
  return request<RollbackResponse>(`/api/projects/${projectId}/connections/${connId}/history/${historyId}/rollback`, {
    method: "POST",
    body: confirmName === undefined ? {} : { confirmName },
  });
}

// ---- Drift: has a linked database left the schema? --------------------------

/** The marks only — no database is contacted. Readable by anyone who can open the project. */
export async function fetchProjectDrift(projectId: string): Promise<ProjectDriftEntry[]> {
  return (await request<{ connections: ProjectDriftEntry[] }>(`/api/projects/${projectId}/drift`)).connections;
}

/** Reads the database now. Project administrators only. */
export function checkProjectDrift(projectId: string, connId: string): Promise<DriftCheckResult> {
  return request<DriftCheckResult>(`/api/projects/${projectId}/connections/${connId}/drift-check`, { method: "POST" });
}

export async function dismissProjectDrift(projectId: string, connId: string): Promise<void> {
  await request<unknown>(`/api/projects/${projectId}/connections/${connId}/drift/dismiss`, { method: "POST" });
}
