import type { SetupPayload, SetupStatus } from "@/services/setupApi";

/** The server's own bounds (`apps/server/src/modules/auth/password.ts`); it also refuses the most common passwords. */
export const SETUP_MIN_PASSWORD_LENGTH = 8;
export const SETUP_MAX_PASSWORD_LENGTH = 128;

export interface SetupDraft {
  email: string;
  displayName: string;
  password: string;
  confirmation: string;
  token: string;
}

export type SetupField = "email" | "displayName" | "password" | "confirmation" | "token";
export type SetupProblem = "required" | "emailInvalid" | "tooShort" | "tooLong" | "mismatch";

export type SetupCheck = { ok: true; payload: SetupPayload } | { ok: false; field: SetupField; problem: SetupProblem };

/** Same shape the server accepts; the server stays the judge. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the form before it is sent, field by field in screen order, and builds the request body. */
export function checkSetupDraft(draft: SetupDraft, tokenRequired: boolean): SetupCheck {
  const email = draft.email.trim();
  const displayName = draft.displayName.trim();
  const token = draft.token.trim();
  if (tokenRequired && !token) return { ok: false, field: "token", problem: "required" };
  if (!email) return { ok: false, field: "email", problem: "required" };
  if (!EMAIL_SHAPE.test(email)) return { ok: false, field: "email", problem: "emailInvalid" };
  if (!displayName) return { ok: false, field: "displayName", problem: "required" };
  if (!draft.password) return { ok: false, field: "password", problem: "required" };
  if (draft.password.length < SETUP_MIN_PASSWORD_LENGTH) return { ok: false, field: "password", problem: "tooShort" };
  if (draft.password.length > SETUP_MAX_PASSWORD_LENGTH) return { ok: false, field: "password", problem: "tooLong" };
  if (draft.password !== draft.confirmation) return { ok: false, field: "confirmation", problem: "mismatch" };
  return {
    ok: true,
    payload: { email, displayName, password: draft.password, ...(tokenRequired ? { token } : {}) },
  };
}

/**
 * What a signed-out visitor sees: the setup screen only while the server says the instance has no account.
 * Unknown status (still loading, or the request failed) falls back to the login form, never to the setup.
 */
export function signedOutScreen(status: SetupStatus | null): "setup" | "login" {
  return status?.needsSetup ? "setup" : "login";
}
