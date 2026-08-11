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
  SNAPSHOT_NOT_FOUND: "errors.snapshotNotFound",
  EMAIL_ALREADY_EXISTS: "errors.emailAlreadyExists",
  INVITATION_ALREADY_USED: "errors.invitationAlreadyUsed",
  PROJECT_LIMIT_REACHED: "errors.projectLimitReached",
  ACCOUNT_LOCKED: "errors.accountLocked",
  INVITATION_FAILED: "errors.invitationFailed",
  INTERNAL_ERROR: "errors.internal",
  DATABASE_UNAVAILABLE: "errors.databaseUnavailable",
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
]);

export type Translator = (key: TranslationKey, options?: TranslateOptions) => string;

/** Turns anything thrown by the API layer into a sentence to show the user. */
export function describeApiError(error: unknown, t: Translator): string {
  if (error instanceof NetworkError) return t("errors.network");
  if (error instanceof ApiError) {
    if (error.code && PREFER_SERVER_MESSAGE.has(error.code)) return error.message;
    const key = error.code ? CODE_TO_KEY[error.code] : undefined;
    return key ? t(key) : error.message;
  }
  return t("errors.unexpected");
}
