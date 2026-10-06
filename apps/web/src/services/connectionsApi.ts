import type {
  DatabaseConnectionConfig,
  DatabaseConnectionSummary,
  DatabaseEngine,
  DeploymentHistoryEntry,
  DriftCheckResult,
  MigrationResolutionMap,
  ProjectDriftEntry,
  ProjectPipeline,
  SchemaRisk,
  SeedPlanEntry,
  SeedResult,
  MySqlAccount,
  PersonalCredentialStatus,
} from "@nebuladb/shared";
import type { LintRuleKey, MigrationDiff, SchemaComparisonEntry } from "@nebuladb/dbml-engine";
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
  /** What each table's seed would do after the DDL. */
  seeds: SeedPlanEntry[];
  /** Seeded tables that depend on each other in a cycle (names) — the deployment refuses them. */
  seedCycles: string[][];
  sqlPreview: string;
  engine: string;
  /** What would refuse this deployment whatever the plan says. */
  blockers: {
    /** Lint findings of level error, when the project refuses to deploy with them; 0 otherwise. */
    lintErrors: number;
    /** The first of those findings — what the dialog names; `lintErrors` is the full count. */
    lintFindings: {
      ruleId: LintRuleKey;
      tableName: string;
      fieldName?: string;
      /** The server's own sentence — the wording of a rule an administrator wrote. */
      message: string;
      params: Record<string, string>;
    }[];
    /** The earlier stage that has to receive this schema first; `null` when none. */
    waitsForStage: string | null;
  };
}

export interface ApplyDeploymentResponse {
  success: boolean;
  executedStatements: number;
  sql: string;
  rollbackAvailable: boolean;
  irreversibleWarnings: string[];
  seedReport: SeedResult[];
  /** The backup taken just before, when there was one. */
  backupId: string | null;
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

/** This user's own account on a connection that asks each user for theirs — its name, never its password. */
export function fetchPersonalCredentials(connectionId: string): Promise<PersonalCredentialStatus> {
  return request<PersonalCredentialStatus>(`/api/connections/${connectionId}/credentials`);
}

/** The server tries the account on the database before keeping it. */
export function savePersonalCredentials(
  connectionId: string,
  username: string,
  password: string,
): Promise<PersonalCredentialStatus> {
  return request<PersonalCredentialStatus>(`/api/connections/${connectionId}/credentials`, {
    method: "PUT",
    body: { username, password },
  });
}

/** A new password for the account already held, set on the database itself — the old one need not be known. */
export function changePersonalPassword(connectionId: string, password: string): Promise<PersonalCredentialStatus> {
  return request<PersonalCredentialStatus>(`/api/connections/${connectionId}/credentials/password`, {
    method: "PUT",
    body: { password },
  });
}

export function deletePersonalCredentials(connectionId: string): Promise<PersonalCredentialStatus> {
  return request<PersonalCredentialStatus>(`/api/connections/${connectionId}/credentials`, { method: "DELETE" });
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

/** `POST /api/projects/:id/connections/compare` — two of the project's databases, read now. */
export interface EnvironmentComparison {
  comparedAt: string;
  source: { id: string; name: string; engine: DatabaseEngine; environment: string | null };
  target: { id: string; name: string; engine: DatabaseEngine; environment: string | null };
  /** Tables that differ; empty when both databases have one structure. */
  tables: SchemaComparisonEntry[];
}

/** Project administrators only: it opens both databases. */
export function compareProjectConnections(
  projectId: string,
  sourceId: string,
  targetId: string,
): Promise<EnvironmentComparison> {
  return request<EnvironmentComparison>(`/api/projects/${projectId}/connections/compare`, {
    method: "POST",
    body: { sourceId, targetId },
  });
}

/** The project's databases along the chain of stages, and how far the current schema has got. Project administrators. */
export async function fetchProjectPipeline(projectId: string): Promise<ProjectPipeline> {
  return (await request<{ pipeline: ProjectPipeline }>(`/api/projects/${projectId}/pipeline`)).pipeline;
}

export async function listProjectConnections(projectId: string): Promise<DatabaseConnectionSummary[]> {
  const res = await request<{ connections: DatabaseConnectionSummary[] }>(`/api/projects/${projectId}/connections`);
  return res.connections;
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
    /** Leave the seeds out of this deployment. */
    skipSeeds?: boolean;
    /** Back the database up first; unset, the server does on the production stage only. */
    backupBefore?: boolean;
    /** Deploy although the stage before is not level — instance administrators, with `skipReason`. */
    skipStageOrder?: boolean;
    skipReason?: string;
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

/** Every personal-account connection this user may use, with their account on each. */
export async function fetchMySqlAccounts(): Promise<MySqlAccount[]> {
  return (await request<{ accounts: MySqlAccount[] }>("/api/me/sql-accounts")).accounts;
}
