import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireUser } from "../../shared/guards.js";
import { getPasswordHash } from "../users/repository.js";
import { verifyPassword } from "./password.js";
import { base32Encode, generateBackupCodes, generateSecret, otpauthUrl, verifyTotp } from "./totp.js";
import {
  confirmTotp,
  consumeBackupCode,
  countUnusedBackupCodes,
  disableTotp,
  getDecryptedSecret,
  getTotpState,
  replaceBackupCodes,
  startTotpSetup,
} from "./totpRepository.js";

async function verifyOwnPassword(userId: string, password: string): Promise<void> {
  const hash = getPasswordHash(userId);
  if (!hash || !(await verifyPassword(password, hash))) throw new ApiError("PASSWORD_INCORRECT");
}

/** Routes managing the caller's own two-factor setup. The login-time verification step lives in `routes.ts` alongside the rest of the login flow. */
export function registerTotpRoutes(app: FastifyInstance): void {
  app.get("/api/auth/totp/status", async (req) => {
    const user = requireUser(req);
    const state = getTotpState(user.id);
    return { enabled: state.enabled, backupCodesRemaining: state.enabled ? countUnusedBackupCodes(user.id) : 0 };
  });

  /**
   * Starts (or restarts) enrollment. Deliberately re-runnable: scanning the QR
   * code, then closing the tab before confirming, shouldn't strand the account
   * in a state only a fresh setup call can escape — each call simply replaces
   * whatever secret was pending.
   */
  app.post("/api/auth/totp/setup", async (req) => {
    const user = requireUser(req);
    if (getTotpState(user.id).enabled) throw new ApiError("TOTP_ALREADY_ENABLED");

    const secret = base32Encode(generateSecret());
    startTotpSetup(user.id, secret);
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  });

  /**
   * Proves the enrolling user can actually produce a code from the secret
   * before it starts gating login — a secret that was only ever displayed,
   * never confirmed, could otherwise lock the account out on a typo'd QR
   * scan. Issues backup codes in the same step, shown to the caller exactly
   * once: only their hash is kept from here on (`totpRepository.ts`).
   */
  app.post("/api/auth/totp/confirm", async (req) => {
    const user = requireUser(req);
    const { code } = (req.body ?? {}) as { code?: string };
    const state = getTotpState(user.id);
    if (state.enabled) throw new ApiError("TOTP_ALREADY_ENABLED");
    if (!state.hasSecret) throw new ApiError("TOTP_SETUP_NOT_STARTED");
    if (!code) throw new ApiError("TOTP_CODE_REQUIRED");

    const secret = getDecryptedSecret(user.id);
    if (!secret || !verifyTotp(secret, code)) throw new ApiError("TOTP_CODE_INCORRECT");

    confirmTotp(user.id);
    const backupCodes = generateBackupCodes();
    replaceBackupCodes(user.id, backupCodes);
    auditUser(user, "user.totp.enable", { type: "user", id: user.id }, undefined, req);
    return { enabled: true, backupCodes };
  });

  /**
   * Requires both the password *and* a still-working second factor — the
   * point of 2FA is that losing the device shouldn't be enough to remove it,
   * so an attacker who only has a stolen session cookie plus a phished
   * password still can't turn it off. A user who has genuinely lost their
   * device uses a backup code here instead of a TOTP code.
   */
  app.post("/api/auth/totp/disable", async (req) => {
    const user = requireUser(req);
    const { password, code } = (req.body ?? {}) as { password?: string; code?: string };
    if (!getTotpState(user.id).enabled) throw new ApiError("TOTP_NOT_ENABLED");
    if (!password) throw new ApiError("PASSWORDS_REQUIRED");
    if (!code) throw new ApiError("TOTP_CODE_REQUIRED");

    await verifyOwnPassword(user.id, password);
    const secret = getDecryptedSecret(user.id);
    if (!secret || !(verifyTotp(secret, code) || consumeBackupCode(user.id, code))) {
      throw new ApiError("TOTP_CODE_INCORRECT");
    }

    disableTotp(user.id);
    auditUser(user, "user.totp.disable", { type: "user", id: user.id }, undefined, req);
    return { enabled: false };
  });

  /** Invalidates every existing backup code and issues a fresh set — for "I used my last one" or "I think an old export leaked". */
  app.post("/api/auth/totp/regenerate-backup-codes", async (req) => {
    const user = requireUser(req);
    const { password } = (req.body ?? {}) as { password?: string };
    if (!getTotpState(user.id).enabled) throw new ApiError("TOTP_NOT_ENABLED");
    if (!password) throw new ApiError("PASSWORDS_REQUIRED");
    await verifyOwnPassword(user.id, password);

    const backupCodes = generateBackupCodes();
    replaceBackupCodes(user.id, backupCodes);
    auditUser(user, "user.totp.backup_codes_regenerate", { type: "user", id: user.id }, undefined, req);
    return { backupCodes };
  });
}
