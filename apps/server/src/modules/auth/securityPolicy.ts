import type { FastifyInstance } from "fastify";
import { db } from "../../infrastructure/db.js";
import { auditUser } from "../../shared/audit.js";
import { requireAdmin } from "../../shared/guards.js";
import { parseBody, z } from "../../shared/validate.js";
import { isTotpEnabled } from "./totpRepository.js";

/**
 * Instance-wide sign-in policy, one `instance_settings` row
 * (`security.auth`, value `{"require2fa": boolean}`).
 *
 * When `require2fa` is on, an account without two-factor authentication can
 * still sign in, but every API route except `/api/auth/*` answers
 * `MFA_SETUP_REQUIRED` until it has enrolled (see the `onRequest` hook in
 * `app.ts`). Refusing the login itself would leave no way to enrol.
 */
const SETTING_KEY = "security.auth";
const CACHE_TTL_MS = 5_000;

export interface SecurityPolicy {
  require2fa: boolean;
}

let cached: { value: SecurityPolicy; at: number } | null = null;

export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const row = (await db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(SETTING_KEY)) as
    | { value: string }
    | undefined;
  let value: SecurityPolicy = { require2fa: false };
  if (row) {
    try {
      value = { require2fa: (JSON.parse(row.value) as { require2fa?: unknown }).require2fa === true };
    } catch {
      // A hand-edited, unreadable row means "no policy" rather than a locked instance.
    }
  }
  cached = { value, at: Date.now() };
  return value;
}

/** True when the policy demands a second factor this account has not set up yet. */
export async function mustSetUpTwoFactor(userId: string): Promise<boolean> {
  if (!(await getSecurityPolicy()).require2fa) return false;
  return !(await isTotpEnabled(userId));
}

const policyBody = z.object({ require2fa: z.boolean() });

export function registerSecurityPolicyRoutes(app: FastifyInstance): void {
  app.get("/api/admin/settings/security", async (req) => {
    requireAdmin(req);
    return await getSecurityPolicy();
  });

  app.put("/api/admin/settings/security", async (req) => {
    const user = requireAdmin(req);
    const { require2fa } = parseBody(policyBody, req);
    await db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = utc_now()`,
      )
      .run(SETTING_KEY, JSON.stringify({ require2fa }), user.id);
    cached = null;
    await auditUser(user, "instance.security", null, require2fa ? "2FA required" : "2FA optional", req);
    return { require2fa };
  });
}
