import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SsoSettingsInput } from "@nebuladb/shared";
import { config } from "../../config.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import {
  PENDING_TTL_MS,
  SsoLoginError,
  decodePendingRedirect,
  finishLogin,
  getSsoSettings,
  resolveSsoUser,
  setSsoSettings,
  startLogin,
  testSsoSettings,
} from "./oidc.js";
import { createSession } from "./session.js";

const PENDING_COOKIE = "nebuladb_sso";
const CALLBACK_PATH = "/api/auth/sso/callback";
const SSO_RATE_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
const ADMIN_LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

/**
 * Where the provider sends the browser back. `NEBULADB_PUBLIC_URL` when set;
 * otherwise the address the browser used. A forged `Host` gains nothing: the
 * provider only redirects to the addresses registered with it.
 */
function redirectUri(req: FastifyRequest): string {
  const base = config.publicUrl ?? `${req.protocol}://${req.headers.host ?? "localhost"}`;
  return `${base}${CALLBACK_PATH}`;
}

/** A path inside the app, never another site: `/project/…`, not `//evil.example` or `https://…`. */
function safeNext(value: unknown): string {
  // No control character or space either: browsers strip tabs and newlines from a `Location`, so `/\t/evil.example` becomes `//evil.example`.
  return typeof value === "string" && /^\/(?![/\\])[^\s\u0000-\u001f\u007f]*$/.test(value) && value.length <= 500
    ? value
    : "/";
}

function pendingCookieOptions(maxAgeMs: number) {
  // Lax: the provider's redirect back is a top-level GET, which still carries it.
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/auth/sso",
    secure: config.cookieSecure,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

function backToLogin(reply: FastifyReply, reason: string) {
  return reply.redirect(`${config.publicUrl ?? ""}/?sso=${encodeURIComponent(reason)}`);
}

export function registerOidcRoutes(app: FastifyInstance): void {
  app.get("/api/auth/sso/start", SSO_RATE_LIMIT, async (req, reply) => {
    const query = req.query as { next?: string; remember?: string };
    try {
      const { url, pending } = await startLogin(redirectUri(req), safeNext(query.next), query.remember !== "0");
      reply.setCookie(PENDING_COOKIE, pending, pendingCookieOptions(PENDING_TTL_MS));
      return reply.redirect(url);
    } catch (err) {
      req.log.warn({ err }, "single sign-on could not start");
      return backToLogin(
        reply,
        err instanceof ApiError && err.code === "SSO_NOT_CONFIGURED" ? "not_configured" : "provider",
      );
    }
  });

  app.get(CALLBACK_PATH, SSO_RATE_LIMIT, async (req, reply) => {
    const cookie = req.cookies[PENDING_COOKIE];
    reply.clearCookie(PENDING_COOKIE, { path: "/api/auth/sso" });
    try {
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      let base: string;
      try {
        base = decodePendingRedirect(cookie);
      } catch {
        throw new SsoLoginError("expired");
      }
      const { identity, pending } = await finishLogin(new URL(`${base}${query}`), cookie);
      const { user, outcome } = await resolveSsoUser(identity);
      if (outcome === "created")
        await auditUser(user, "user.sso.create", { type: "user", id: user.id }, identity.issuer, req);
      if (outcome === "linked")
        await auditUser(user, "user.sso.link", { type: "user", id: user.id }, identity.issuer, req);
      await auditUser(user, "auth.sso.login", { type: "user", id: user.id }, identity.issuer, req);
      await createSession(user.id, reply, req, { remember: pending.remember });
      return reply.redirect(`${config.publicUrl ?? ""}${pending.next}`);
    } catch (err) {
      const reason = err instanceof SsoLoginError ? err.reason : "provider";
      req.log.warn({ err }, "single sign-on refused");
      await auditUser(
        null,
        "auth.sso.refused",
        null,
        `${reason}: ${err instanceof Error ? err.message : ""}`.slice(0, 300),
        req,
      );
      return backToLogin(reply, reason);
    }
  });

  app.get("/api/admin/settings/sso", ADMIN_LIMIT, async (req) => {
    requireAdmin(req);
    return { settings: await getSsoSettings(), redirectUri: redirectUri(req) };
  });

  app.put("/api/admin/settings/sso", ADMIN_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const settings = await setSsoSettings((req.body ?? {}) as SsoSettingsInput, user.id);
    await auditUser(
      user,
      "instance.sso",
      null,
      settings.enabled ? `on: ${settings.issuer} (${settings.clientId})` : "off",
      req,
    );
    return { settings, redirectUri: redirectUri(req) };
  });

  app.post("/api/admin/settings/sso/test", ADMIN_LIMIT, async (req) => {
    requireAdmin(req);
    return await testSsoSettings((req.body ?? {}) as SsoSettingsInput);
  });
}
