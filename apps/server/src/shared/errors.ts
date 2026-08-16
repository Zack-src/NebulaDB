import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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
  CONNECTION_ENGINE_INVALID: { status: 400, message: "engine must be one of postgres, mysql, sqlite" },
  CONNECTION_TARGET_FORBIDDEN: { status: 400, message: "this connection target is not allowed" },
  TOTP_ALREADY_ENABLED: { status: 400, message: "two-factor authentication is already enabled" },
  TOTP_NOT_ENABLED: { status: 400, message: "two-factor authentication is not enabled" },
  TOTP_SETUP_NOT_STARTED: { status: 400, message: "start two-factor setup before confirming it" },
  TOTP_CODE_REQUIRED: { status: 400, message: "a verification code is required" },
  MFA_TOKEN_REQUIRED: { status: 400, message: "mfaToken and a code are required" },
  DEPLOYMENT_HISTORY_NOT_FOUND: { status: 400, message: "no such deployment history entry" },
  ROLLBACK_NOT_AVAILABLE: { status: 400, message: "no rollback SQL is available for this deployment" },
  ROLLBACK_ALREADY_ATTEMPTED: { status: 400, message: "this deployment has already been rolled back" },

  // --- 401 ---
  AUTH_REQUIRED: { status: 401, message: "authentication required" },
  INVALID_CREDENTIALS: { status: 401, message: "invalid email or password" },
  CURRENT_PASSWORD_INCORRECT: { status: 401, message: "current password is incorrect" },
  PASSWORD_INCORRECT: { status: 401, message: "password is incorrect" },
  TOTP_CODE_INCORRECT: { status: 401, message: "incorrect verification code" },
  MFA_CHALLENGE_INVALID: { status: 401, message: "this login challenge has expired — sign in again" },

  // --- 403 ---
  ADMIN_REQUIRED: { status: 403, message: "administrator access required" },
  FORBIDDEN: { status: 403, message: "forbidden" },
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

  // --- 409 ---
  EMAIL_ALREADY_EXISTS: { status: 409, message: "a user with this email already exists" },
  INVITATION_ALREADY_USED: { status: 409, message: "this invitation has already been used" },
  PROJECT_LIMIT_REACHED: { status: 409, message: "you have reached the maximum number of projects" },

  // --- 429 ---
  ACCOUNT_LOCKED: { status: 429, message: "too many failed attempts — this account is temporarily locked" },

  // --- 5xx ---
  INVITATION_FAILED: { status: 500, message: "could not complete the invitation" },
  INTERNAL_ERROR: { status: 500, message: "internal server error" },
  DATABASE_UNAVAILABLE: { status: 503, message: "database unavailable" },
  CONNECTION_SECRET_MISSING: {
    status: 503,
    message: "ATHANORDB_SECRET must be configured before a database connection can be stored",
  },
  MIGRATION_FAILED: { status: 502, message: "the migration could not be applied to the target database" },
  ROLLBACK_FAILED: { status: 502, message: "the rollback could not be applied to the target database" },
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
    return reply.code(500).send(new ApiError("INTERNAL_ERROR").toPayload());
  });
}
