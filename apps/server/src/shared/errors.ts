import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { recordError, tallyErrorForMetrics } from "./errorLog.js";

/**
 * Every error the API can return, in one place.
 *
 * The `code` is the stable contract: clients switch on it to pick a localised
 * message, so renaming an English `message` here never changes what a user
 * reads. The `message` stays in the payload for direct API consumers, logs, and
 * as the client's fallback when it meets a code it doesn't know yet.
 */
export const ERROR_CATALOG = {
  // --- 400 ---
  NAME_REQUIRED: { status: 400, message: "name is required" },
  NAME_TOO_LONG: { status: 400, message: "name must be 200 characters or fewer" },
  NAME_OR_STATUS_REQUIRED: { status: 400, message: "name or status is required" },
  PROJECT_TEMPLATE_INVALID: { status: 400, message: "template must be one of blog, ecommerce, saas, auth" },
  PROJECT_STATUS_INVALID: { status: 400, message: "status must be one of active, archived, trashed" },
  PERMISSION_INVALID: { status: 400, message: "permission must be one of view, edit, administrator" },
  SOURCE_REQUIRED: { status: 400, message: "source is required" },
  SQL_DIALECT_INVALID: { status: 400, message: "dialect must be one of postgres, mysql, mssql" },
  DBML_PARSE_FAILED: { status: 400, message: "the DBML source could not be parsed" },
  SQL_PARSE_FAILED: { status: 400, message: "the SQL source could not be parsed" },
  EXPORT_FAILED: { status: 400, message: "the schema could not be exported" },
  CREDENTIALS_REQUIRED: { status: 400, message: "email and password are required" },
  DISPLAY_NAME_REQUIRED: { status: 400, message: "displayName is required" },
  PASSWORDS_REQUIRED: { status: 400, message: "currentPassword and newPassword are required" },
  PASSWORD_REQUIRED_FOR_DELETION: { status: 400, message: "password is required to delete your account" },
  PASSWORD_RESET_TOKEN_INVALID: {
    status: 400,
    message: "this password reset link is invalid, expired or already used",
  },
  PASSWORD_TOO_WEAK: { status: 400, message: "the password does not meet the minimum requirements" },
  EMAIL_INVALID: { status: 400, message: "a valid email is required" },
  USER_ID_INVALID: { status: 400, message: "a valid userId is required" },
  DISABLED_MUST_BE_BOOLEAN: { status: 400, message: "disabled must be a boolean" },
  LIMIT_MUST_BE_NUMBER: { status: 400, message: "limit must be a number" },
  TRANSFER_TARGET_INVALID: { status: 400, message: "transferProjectsTo must be another existing user" },
  CANNOT_DELETE_SELF: { status: 400, message: "you cannot delete your own account" },
  CANNOT_DISABLE_SELF: { status: 400, message: "you cannot disable your own account" },
  LAST_ADMIN: { status: 400, message: "this is the last active administrator" },
  LAST_ADMIN_SELF: {
    status: 400,
    message: "you are the last active administrator — grant admin to someone else first",
  },
  INVITATION_INVALID: { status: 400, message: "this invitation is no longer valid" },
  CONNECTION_ENGINE_INVALID: { status: 400, message: "engine must be one of postgres, mysql, mssql, oracle, sqlite" },
  CONNECTION_TARGET_FORBIDDEN: { status: 400, message: "this connection target is not allowed" },
  DB_ADMIN_INPUT_INVALID: {
    status: 400,
    message: "the request is missing a required field or names an unknown object",
  },
  DB_ADMIN_UNSUPPORTED: { status: 400, message: "this operation is not supported by this database engine" },
  DB_ADMIN_SYSTEM_OBJECT: {
    status: 400,
    message: "system databases, schemas and accounts cannot be modified from here",
  },
  DB_ADMIN_CONFIRMATION_MISMATCH: { status: 400, message: "the confirmation does not match the name of the object" },
  DB_ADMIN_WRITE_NOT_ALLOWED: {
    status: 400,
    message: "this statement modifies data or structure — switch the console to write mode to run it",
  },
  TOTP_ALREADY_ENABLED: { status: 400, message: "two-factor authentication is already enabled" },
  TOTP_NOT_ENABLED: { status: 400, message: "two-factor authentication is not enabled" },
  TOTP_SETUP_NOT_STARTED: { status: 400, message: "start two-factor setup before confirming it" },
  TOTP_CODE_REQUIRED: { status: 400, message: "a verification code is required" },
  MFA_TOKEN_REQUIRED: { status: 400, message: "mfaToken and a code are required" },
  CLIENT_ERROR_MESSAGE_REQUIRED: { status: 400, message: "message is required" },
  ERROR_LOG_SOURCE_INVALID: { status: 400, message: "source must be one of server, client" },
  DEPLOYMENT_HISTORY_NOT_FOUND: { status: 400, message: "no such deployment history entry" },
  STRUCTURE_POLICY_INVALID: {
    status: 400,
    message: "policy must be one of schema-only, warn, free, and applyToSql a boolean",
  },
  TABLE_LOCK_INVALID: {
    status: 400,
    message: "level must be structure or full, authority project or instance, reason a string",
  },
  ENVIRONMENT_INVALID: {
    status: 400,
    message: "a stage needs a name (at most 40 characters); colour, protection and production must be known values",
  },
  SEED_INVALID: {
    status: 400,
    message: "a seed needs CSV content (at most 2 MB, 50 000 rows) and valid options: separator, header, mapping, mode",
  },
  MONITORING_INVALID: {
    status: 400,
    message: "monitoring: enabled (boolean), intervalMinutes (5, 15, 60, 360 or 1440), ignoreTables (names)",
  },
  LINT_INVALID: {
    status: 400,
    message:
      "lint: profile (relaxed, standard, strict, custom), rules (rule id: off, info, warning, error), ignores " +
      "({ruleId, tableId, tableName}), forbiddenTypes, requiredColumns (names), blockDeployment (boolean)",
  },
  BACKUP_INVALID: {
    status: 400,
    message:
      "backup: tables (names of this database), note (500 characters at most), pinned (boolean); schedule: enabled, " +
      "frequency (daily, weekly, monthly), hour (0–23), weekday (0–6), dayOfMonth (1–28), keep (1–365)",
  },
  ACTIVITY_QUERY_INVALID: {
    status: 400,
    message: "activity filters: dates as YYYY-MM-DD[ HH:MM[:SS]], a known category, an integer cursor",
  },
  GENERATOR_INVALID: {
    status: 400,
    message: "a generation needs rows (1 to 10 000), an integer seed, a locale (fr, en) and known column generators",
  },
  RESTORE_TABLES_INVALID: { status: 400, message: "tableIds must be a non-empty array of table ids (at most 500)" },
  ROLLBACK_NOT_AVAILABLE: { status: 400, message: "no rollback SQL is available for this deployment" },
  ROLLBACK_ALREADY_ATTEMPTED: { status: 400, message: "this deployment has already been rolled back" },
  API_KEY_NAME_REQUIRED: { status: 400, message: "name is required" },
  WEBHOOK_URL_INVALID: { status: 400, message: "url must be an absolute http(s) URL without credentials" },
  WEBHOOK_ENABLED_INVALID: { status: 400, message: "enabled must be a boolean" },
  WEBHOOK_FORMAT_INVALID: { status: 400, message: "format must be one of json, slack, discord" },
  WEBHOOK_EVENTS_INVALID: {
    status: 400,
    message: "events must be a non-empty array of schema.changed, deployment.completed, drift.detected",
  },
  API_KEY_SCOPES_INVALID: {
    status: 400,
    message: "scopes must be a non-empty array of projects:read, projects:write, deployments:trigger",
  },

  // --- 401 ---
  AUTH_REQUIRED: { status: 401, message: "authentication required" },
  API_KEY_INVALID: { status: 401, message: "invalid or revoked API key" },
  INVALID_CREDENTIALS: { status: 401, message: "invalid email or password" },
  CURRENT_PASSWORD_INCORRECT: { status: 401, message: "current password is incorrect" },
  PASSWORD_INCORRECT: { status: 401, message: "password is incorrect" },
  TOTP_CODE_INCORRECT: { status: 401, message: "incorrect verification code" },
  MFA_CHALLENGE_INVALID: { status: 401, message: "this login challenge has expired — sign in again" },

  // --- 403 ---
  ADMIN_REQUIRED: { status: 403, message: "administrator access required" },
  FORBIDDEN: { status: 403, message: "forbidden" },
  API_SCOPE_INSUFFICIENT: { status: 403, message: "this API key does not have the required scope" },
  API_KEY_PROJECT_RESTRICTED: { status: 403, message: "this API key is restricted to a different project" },
  CONNECTION_READ_ONLY: { status: 403, message: "this connection is marked read-only" },
  TABLE_LOCKED: { status: 403, message: "this change touches a locked table" },
  TABLE_LOCK_FORBIDDEN: { status: 403, message: "this lock can only be changed by an instance administrator" },
  CONNECTION_MANAGED_BY_ADMIN: {
    status: 403,
    message: "this connection is managed by an instance administrator and cannot be changed from a project",
  },
  ACCOUNT_DISABLED: { status: 403, message: "this account has been disabled" },
  ORIGIN_INVALID: { status: 403, message: "invalid origin" },
  ORIGIN_MISMATCH: { status: 403, message: "cross-origin request refused" },

  // --- 404 ---
  NOT_FOUND: { status: 404, message: "not found" },
  PROJECT_NOT_FOUND: { status: 404, message: "project not found" },
  TEAM_NOT_FOUND: { status: 404, message: "no such team" },
  REVISION_NOT_FOUND: { status: 404, message: "no such revision for this project" },
  SNAPSHOT_NOT_FOUND: { status: 404, message: "no snapshot saved yet" },
  CONNECTION_NOT_FOUND: { status: 404, message: "connection not found" },
  API_KEY_NOT_FOUND: { status: 404, message: "no such API key" },
  WEBHOOK_NOT_FOUND: { status: 404, message: "no such webhook on this project" },
  TABLE_NOT_FOUND: { status: 404, message: "no such table in this project" },
  ENVIRONMENT_NOT_FOUND: { status: 404, message: "no such environment stage" },
  BACKUP_NOT_FOUND: { status: 404, message: "no such backup" },
  SEED_NOT_FOUND: { status: 404, message: "this table has no seed" },

  // --- 409 ---
  EMAIL_ALREADY_EXISTS: { status: 409, message: "a user with this email already exists" },
  INVITATION_ALREADY_USED: { status: 409, message: "this invitation has already been used" },
  PROJECT_LIMIT_REACHED: { status: 409, message: "you have reached the maximum number of projects" },
  CONNECTION_IN_USE: {
    status: 409,
    message: "this connection is still attached to one or more projects — confirm to delete it anyway",
  },
  WEBHOOK_LIMIT_REACHED: { status: 409, message: "a project can have at most 10 webhooks" },

  // --- 429 ---
  ACCOUNT_LOCKED: { status: 429, message: "too many failed attempts — this account is temporarily locked" },
  CONNECTION_RATE_LIMITED: {
    status: 429,
    message: "too many operations against this database in the last minute — wait before retrying",
  },

  STRUCTURE_VIA_SCHEMA: {
    status: 409,
    message: "structure changes on this database go through its schema — make the change in the project and deploy it",
  },
  SEEDS_NOT_DEPLOYABLE: {
    status: 409,
    message: "a seed of this project has errors or its tables depend on each other in a cycle — fix it before deploying",
  },
  LINT_BLOCKS_DEPLOYMENT: {
    status: 409,
    message: "the schema has lint errors and this project refuses to deploy with them — fix them or relax the rules",
  },
  DEPLOYMENT_BLOCKED_BY_RISK: {
    status: 409,
    message: "a change in this plan is set to “cancel / handle manually” — fix the data or change the schema, then deploy",
  },
  DESTRUCTIVE_CHANGE_UNRESOLVED: {
    status: 409,
    message: "this plan loses or rejects data on the production stage — send a resolution for each critical risk",
  },
  PRODUCTION_CONFIRMATION_REQUIRED: {
    status: 409,
    message: "this connection is the production stage — send its name as confirmName to deploy or roll back",
  },
  BACKUP_ALREADY_RUNNING: { status: 409, message: "a backup of this database is already running" },
  BACKUP_NOT_READY: { status: 409, message: "this backup is not finished, or did not complete" },
  BACKUP_CORRUPTED: {
    status: 409,
    message: "the stored backup file is missing or no longer matches its checksum",
  },
  RESTORE_CONFIRMATION_REQUIRED: {
    status: 409,
    message: "a restore replaces data — send the target connection's name as confirmName",
  },
  RESTORE_TARGET_MISMATCH: { status: 409, message: "this backup cannot be restored into that database" },
  ENVIRONMENT_NAME_TAKEN: { status: 409, message: "another stage already has this name" },
  STRUCTURE_CONFIRMATION_REQUIRED: {
    status: 409,
    message: "this statement changes the structure outside the schema — confirm to run it anyway",
  },

  // --- 5xx ---
  INVITATION_FAILED: { status: 500, message: "could not complete the invitation" },
  INTERNAL_ERROR: { status: 500, message: "internal server error" },
  DATABASE_UNAVAILABLE: { status: 503, message: "database unavailable" },
  CONNECTION_SECRET_MISSING: {
    status: 503,
    message: "ATHANORDB_SECRET must be configured before a database connection can be stored",
  },
  PASSWORD_RESET_UNAVAILABLE: {
    status: 503,
    message: "password reset by email is not available: this instance has no email configured",
  },
  DB_ADMIN_QUERY_FAILED: { status: 502, message: "the target database rejected the statement" },
  MIGRATION_FAILED: { status: 502, message: "the migration could not be applied to the target database" },
  ROLLBACK_FAILED: { status: 502, message: "the rollback could not be applied to the target database" },
  BACKUP_FAILED: { status: 502, message: "the safety backup did not complete, so nothing was changed" },
} as const;

export type ApiErrorCode = keyof typeof ERROR_CATALOG;

export interface ApiErrorOptions {
  /** Overrides the catalogue message when the specifics matter (a parser's own diagnostic, a limit value). */
  message?: string;
  /** Extra fields merged into the response body — e.g. `line`/`column` for a parse failure. */
  details?: Record<string, unknown>;
}

/** Thrown from anywhere in a request; `registerErrorHandler` turns it into the response. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, options: ApiErrorOptions = {}) {
    const entry = ERROR_CATALOG[code];
    super(options.message ?? entry.message);
    this.name = "ApiError";
    this.code = code;
    this.status = entry.status;
    this.details = options.details;
  }

  toPayload(): Record<string, unknown> {
    return { error: this.message, code: this.code, ...this.details };
  }
}

/**
 * Single exit point for every error response. Unknown throws become a generic
 * 500 with the original logged — an internal message (a SQL string, a file
 * path) must never reach the client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send(err.toPayload());
    }
    // Fastify's own errors (body too large, malformed JSON, rate limit) already
    // carry a sensible status; keep it and pass their message through.
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({ error: err.message, code: err.code ?? "BAD_REQUEST" });
    }
    req.log.error({ err }, "unhandled error");
    tallyErrorForMetrics("server");
    recordError("server", err.message, {
      stack: err.stack,
      context: `${req.method} ${req.url}`,
      user: req.user ? { id: req.user.id, email: req.user.email } : null,
    });
    return reply.code(500).send(new ApiError("INTERNAL_ERROR").toPayload());
  });
}
