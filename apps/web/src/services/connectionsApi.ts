import type {
  DatabaseConnectionConfig,
  DatabaseConnectionSummary,
  MigrationResolutionMap,
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
): Promise<ApplyDeploymentResponse> {
  return request<ApplyDeploymentResponse>(`/api/projects/${projectId}/connections/${connId}/apply-deployment`, {
    method: "POST",
    body: { resolutions },
  });
}
