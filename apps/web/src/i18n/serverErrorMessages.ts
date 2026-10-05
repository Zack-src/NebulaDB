import { ApiError, NetworkError } from "@/services/ApiError";
import type { TranslateOptions, TranslationKey } from "./translate";

/**
 * Maps the server's stable error codes (`apps/server/src/shared/errors.ts`) to
 * dictionary keys.
 *
 * Before this the UI rendered `data.error` straight from the response, so a
 * French interface showed English sentences like "project not found" whenever
 * something went wrong. Codes are the contract; the English `message` survives
 * only as the fallback for a code this build hasn't been taught yet.
 */
const CODE_TO_KEY: Record<string, TranslationKey> = {
  NAME_REQUIRED: "errors.nameRequired",
  NAME_TOO_LONG: "errors.nameTooLong",
  NAME_OR_STATUS_REQUIRED: "errors.nameOrStatusRequired",
  PROJECT_TEMPLATE_INVALID: "errors.projectTemplateInvalid",
  PROJECT_STATUS_INVALID: "errors.projectStatusInvalid",
  PERMISSION_INVALID: "errors.permissionInvalid",
  SOURCE_REQUIRED: "errors.sourceRequired",
  SQL_DIALECT_INVALID: "errors.sqlDialectInvalid",
  DBML_PARSE_FAILED: "errors.dbmlParseFailed",
  SQL_PARSE_FAILED: "errors.sqlParseFailed",
  EXPORT_FAILED: "errors.exportFailed",
  CREDENTIALS_REQUIRED: "errors.credentialsRequired",
  DISPLAY_NAME_REQUIRED: "errors.displayNameRequired",
  PASSWORDS_REQUIRED: "errors.passwordsRequired",
  PASSWORD_REQUIRED_FOR_DELETION: "errors.passwordRequiredForDeletion",
  PASSWORD_RESET_TOKEN_INVALID: "errors.passwordResetTokenInvalid",
  PASSWORD_RESET_UNAVAILABLE: "errors.passwordResetUnavailable",
  PASSWORD_TOO_WEAK: "errors.passwordTooWeak",
  EMAIL_INVALID: "errors.emailInvalid",
  USER_ID_INVALID: "errors.userIdInvalid",
  DISABLED_MUST_BE_BOOLEAN: "errors.disabledMustBeBoolean",
  LIMIT_MUST_BE_NUMBER: "errors.limitMustBeNumber",
  TRANSFER_TARGET_INVALID: "errors.transferTargetInvalid",
  CANNOT_DELETE_SELF: "errors.cannotDeleteSelf",
  CANNOT_DISABLE_SELF: "errors.cannotDisableSelf",
  LAST_ADMIN: "errors.lastAdmin",
  LAST_ADMIN_SELF: "errors.lastAdminSelf",
  INVITATION_INVALID: "errors.invitationInvalid",
  AUTH_REQUIRED: "errors.authRequired",
  INVALID_CREDENTIALS: "errors.invalidCredentials",
  CURRENT_PASSWORD_INCORRECT: "errors.currentPasswordIncorrect",
  PASSWORD_INCORRECT: "errors.passwordIncorrect",
  ADMIN_REQUIRED: "errors.adminRequired",
  FORBIDDEN: "errors.forbidden",
  ACCOUNT_DISABLED: "errors.accountDisabled",
  ORIGIN_INVALID: "errors.originInvalid",
  ORIGIN_MISMATCH: "errors.originMismatch",
  NOT_FOUND: "errors.notFound",
  PROJECT_NOT_FOUND: "errors.projectNotFound",
  TEAM_NOT_FOUND: "errors.teamNotFound",
  REVISION_NOT_FOUND: "errors.revisionNotFound",
  RESTORE_TABLES_INVALID: "errors.restoreTablesInvalid",
  SNAPSHOT_NOT_FOUND: "errors.snapshotNotFound",
  EMAIL_ALREADY_EXISTS: "errors.emailAlreadyExists",
  INVITATION_ALREADY_USED: "errors.invitationAlreadyUsed",
  PROJECT_LIMIT_REACHED: "errors.projectLimitReached",
  ACCOUNT_LOCKED: "errors.accountLocked",
  CONNECTION_RATE_LIMITED: "errors.connectionRateLimited",
  WEBHOOK_URL_INVALID: "errors.webhookUrlInvalid",
  WEBHOOK_EVENTS_INVALID: "errors.webhookEventsInvalid",
  WEBHOOK_LIMIT_REACHED: "errors.webhookLimitReached",
  WEBHOOK_NOT_FOUND: "errors.webhookNotFound",
  CONNECTION_TARGET_FORBIDDEN: "errors.connectionTargetForbidden",
  CONNECTION_READ_ONLY: "errors.connectionReadOnly",
  CONNECTION_MANAGED_BY_ADMIN: "errors.connectionManagedByAdmin",
  CONNECTION_IN_USE: "errors.connectionInUse",
  DB_ADMIN_SYSTEM_OBJECT: "errors.dbAdminSystemObject",
  DB_ADMIN_CONFIRMATION_MISMATCH: "errors.dbAdminConfirmationMismatch",
  DB_ADMIN_UNSUPPORTED: "errors.dbAdminUnsupported",
  DB_ADMIN_WRITE_NOT_ALLOWED: "errors.dbAdminWriteNotAllowed",
  INVITATION_FAILED: "errors.invitationFailed",
  INTERNAL_ERROR: "errors.internal",
  DATABASE_UNAVAILABLE: "errors.databaseUnavailable",
  TOTP_ALREADY_ENABLED: "errors.totpAlreadyEnabled",
  TOTP_NOT_ENABLED: "errors.totpNotEnabled",
  TOTP_SETUP_NOT_STARTED: "errors.totpSetupNotStarted",
  TOTP_CODE_REQUIRED: "errors.totpCodeRequired",
  TOTP_CODE_INCORRECT: "errors.totpCodeIncorrect",
  MFA_TOKEN_REQUIRED: "errors.mfaTokenRequired",
  MFA_CHALLENGE_INVALID: "errors.mfaChallengeInvalid",
  DEPLOYMENT_HISTORY_NOT_FOUND: "errors.deploymentHistoryNotFound",
  ROLLBACK_NOT_AVAILABLE: "errors.rollbackNotAvailable",
  ROLLBACK_ALREADY_ATTEMPTED: "errors.rollbackAlreadyAttempted",
  STRUCTURE_VIA_SCHEMA: "errors.structureViaSchema",
  STRUCTURE_CONFIRMATION_REQUIRED: "errors.structureConfirmationRequired",
  STRUCTURE_POLICY_INVALID: "errors.structurePolicyInvalid",
  TABLE_LOCKED: "errors.tableLocked",
  TABLE_LOCK_FORBIDDEN: "errors.tableLockForbidden",
  TABLE_LOCK_INVALID: "errors.tableLockInvalid",
  TABLE_NOT_FOUND: "errors.tableNotFound",
  ENVIRONMENT_INVALID: "errors.environmentInvalid",
  ENVIRONMENT_NOT_FOUND: "errors.environmentNotFound",
  ENVIRONMENT_NAME_TAKEN: "errors.environmentNameTaken",
  PRODUCTION_CONFIRMATION_REQUIRED: "errors.productionConfirmationRequired",
  PERSONAL_CREDENTIALS_REQUIRED: "errors.personalCredentialsRequired",
  PERSONAL_CREDENTIALS_NOT_USED: "errors.personalCredentialsNotUsed",
  PERSONAL_CREDENTIALS_INVALID: "errors.personalCredentialsInvalid",
  PERSONAL_CREDENTIALS_REJECTED: "errors.personalCredentialsRejected",
  DB_ACCESS_INVALID: "errors.dbAccessInvalid",
  DB_ACCESS_WRITE_FORBIDDEN: "errors.dbAccessWriteForbidden",
  DB_ACCESS_WRITE_CONFIRMATION_REQUIRED: "errors.dbAccessWriteConfirmationRequired",
  DB_ACCESS_STATEMENT_NOT_ALLOWED: "errors.dbAccessStatementNotAllowed",
  DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED: "errors.dbAdminConnectionAccountProtected",
  CONNECTION_AUTH_MODE_INVALID: "errors.connectionAuthModeInvalid",
  DEPLOYMENT_BLOCKED_BY_RISK: "errors.deploymentBlockedByRisk",
  SEED_INVALID: "errors.seedInvalid",
  GENERATOR_INVALID: "errors.generatorInvalid",
  ACTIVITY_QUERY_INVALID: "errors.activityQueryInvalid",
  MONITORING_INVALID: "errors.monitoringInvalid",
  DATABASE_TABLE_NOT_FOUND: "errors.databaseTableNotFound",
  COMPARISON_INVALID: "errors.comparisonInvalid",
  SUBSCRIPTION_INVALID: "errors.subscriptionInvalid",
  COMMENT_NOTICE_INVALID: "errors.commentNoticeInvalid",
  LINT_INVALID: "errors.lintInvalid",
  LINT_BLOCKS_DEPLOYMENT: "errors.lintBlocksDeployment",
  LINT_PRESET_NOT_FOUND: "errors.lintPresetNotFound",
  LINT_PRESET_NAME_TAKEN: "errors.lintPresetNameTaken",
  LINT_PRESET_LIMIT: "errors.lintPresetLimit",
  VARIABLES_UNRESOLVED: "errors.variablesUnresolved",
  PIPELINE_STAGE_SKIPPED: "errors.pipelineStageSkipped",
  STAGE_SKIP_REASON_REQUIRED: "errors.stageSkipReasonRequired",
  SEED_NOT_FOUND: "errors.seedNotFound",
  SEEDS_NOT_DEPLOYABLE: "errors.seedsNotDeployable",
  DESTRUCTIVE_CHANGE_UNRESOLVED: "errors.destructiveChangeUnresolved",
  BACKUP_INVALID: "errors.backupInvalid",
  BACKUP_NOT_FOUND: "errors.backupNotFound",
  BACKUP_ALREADY_RUNNING: "errors.backupAlreadyRunning",
  BACKUP_NOT_READY: "errors.backupNotReady",
  BACKUP_CORRUPTED: "errors.backupCorrupted",
  RESTORE_CONFIRMATION_REQUIRED: "errors.restoreConfirmationRequired",
  RESTORE_TARGET_MISMATCH: "errors.restoreTargetMismatch",
};

/**
 * Codes whose server message carries specifics the translation can't reproduce
 * (a parser's line-level diagnostic, the actual project ceiling). For these the
 * server's own text is more useful than a generic translated sentence.
 */
const PREFER_SERVER_MESSAGE = new Set([
  "DBML_PARSE_FAILED",
  "SQL_PARSE_FAILED",
  "EXPORT_FAILED",
  "PASSWORD_TOO_WEAK",
  "PROJECT_LIMIT_REACHED",
  // Says why the backup did not complete (too large, unreachable, a table that cannot be read).
  "BACKUP_FAILED",
]);

export type Translator = (key: TranslationKey, options?: TranslateOptions) => string;

/** Turns anything thrown by the API layer into a sentence to show the user. */
export function describeApiError(error: unknown, t: Translator): string {
  if (error instanceof NetworkError) return t("errors.network");
  if (error instanceof ApiError) {
    if (error.code && PREFER_SERVER_MESSAGE.has(error.code)) return error.message;
    const key = error.code ? CODE_TO_KEY[error.code] : undefined;
    if (!key) return error.message;
    // The one code whose translation names what the server found: which tables were in the way.
    if (error.code === "PERSONAL_CREDENTIALS_REQUIRED") {
      return t(key, { connection: String(error.details.connectionName ?? "") });
    }
    // The database's own words are the useful part: "password authentication failed for user …".
    if (error.code === "PERSONAL_CREDENTIALS_REJECTED") return t(key, { reason: String(error.details.reason ?? "") });
    const tables = error.details.tables;
    return error.code === "TABLE_LOCKED" && Array.isArray(tables) ? t(key, { tables: tables.join(", ") }) : t(key);
  }
  return t("errors.unexpected");
}
