import crypto from "node:crypto";
import * as oidc from "openid-client";
import type { SsoSettings, SsoSettingsInput } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";
import { resolveAllowedHost } from "../connections/hostGuard.js";
import { normalizeEmail } from "./email.js";

/**
 * Single sign-on through one OpenID Connect provider (Keycloak, Entra ID,
 * Google Workspace, Authentik, Okta…), set by an administrator in the console.
 * The settings are one `instance_settings` row; the client secret inside is
 * encrypted like a connection's password.
 */

const SETTING_KEY = "sso";
const MAX_DOMAINS = 50;

interface StoredSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretEncrypted: string | null;
  buttonLabel: string;
  autoCreate: boolean;
  allowedDomains: string[];
}

const DEFAULTS: StoredSettings = {
  enabled: false,
  issuer: "",
  clientId: "",
  clientSecretEncrypted: null,
  buttonLabel: "",
  autoCreate: false,
  allowedDomains: [],
};

async function readStored(): Promise<StoredSettings> {
  const row = (await db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(SETTING_KEY)) as
    { value: string } | undefined;
  if (!row) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<StoredSettings>) };
  } catch {
    return DEFAULTS;
  }
}

function toSettings(stored: StoredSettings): SsoSettings {
  return {
    enabled: stored.enabled,
    issuer: stored.issuer,
    clientId: stored.clientId,
    hasClientSecret: Boolean(stored.clientSecretEncrypted),
    buttonLabel: stored.buttonLabel,
    autoCreate: stored.autoCreate,
    allowedDomains: stored.allowedDomains,
  };
}

export async function getSsoSettings(): Promise<SsoSettings> {
  return toSettings(await readStored());
}

/** An `https` issuer, or `http` on this machine only (a provider run next to NebulaDB, a test). */
function parseIssuer(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new ApiError("SSO_SETTINGS_INVALID");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError("SSO_SETTINGS_INVALID");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ApiError("SSO_SETTINGS_INVALID");
  if (url.username || url.password || url.search || url.hash) throw new ApiError("SSO_SETTINGS_INVALID");
  return url;
}

function issuerString(url: URL): string {
  return url.href.replace(/\/+$/, "");
}

function parseDomains(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_DOMAINS) throw new ApiError("SSO_SETTINGS_INVALID");
  const domains = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") throw new ApiError("SSO_SETTINGS_INVALID");
    const domain = value.trim().toLowerCase().replace(/^@/, "");
    if (!domain) continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new ApiError("SSO_SETTINGS_INVALID");
    domains.add(domain);
  }
  return [...domains];
}

/**
 * Saves what the console sent. An empty or missing secret keeps the stored
 * one, `null` removes it (a public client using PKCE alone). Turning it on
 * needs an issuer and a client id; the provider itself is not asked here —
 * that is what the console's "Tester" is for.
 */
export async function setSsoSettings(input: SsoSettingsInput, userId: string): Promise<SsoSettings> {
  const before = await readStored();
  const enabled = Boolean(input.enabled);
  const issuer = input.issuer?.trim() ? issuerString(parseIssuer(input.issuer)) : "";
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  if (enabled && (!issuer || !clientId)) throw new ApiError("SSO_SETTINGS_INVALID");
  if (clientId.length > 500 || (typeof input.buttonLabel === "string" && input.buttonLabel.length > 80))
    throw new ApiError("SSO_SETTINGS_INVALID");
  let clientSecretEncrypted = before.clientSecretEncrypted;
  if (input.clientSecret === null) clientSecretEncrypted = null;
  else if (typeof input.clientSecret === "string" && input.clientSecret !== "")
    clientSecretEncrypted = encryptPayload(input.clientSecret);
  // A secret belongs to one client at one provider: changing either drops it unless a new one comes along.
  if ((issuer !== before.issuer || clientId !== before.clientId) && !input.clientSecret) clientSecretEncrypted = null;

  const stored: StoredSettings = {
    enabled,
    issuer,
    clientId,
    clientSecretEncrypted,
    buttonLabel: typeof input.buttonLabel === "string" ? input.buttonLabel.trim() : "",
    autoCreate: Boolean(input.autoCreate),
    allowedDomains: parseDomains(input.allowedDomains),
  };
  await db
    .prepare(
      `INSERT INTO instance_settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = utc_now()`,
    )
    .run(SETTING_KEY, JSON.stringify(stored), userId);
  discovered = null;
  return toSettings(stored);
}

/** What the login page needs: whether to offer the button, and its words. */
export async function publicSsoInfo(): Promise<{ enabled: boolean; buttonLabel: string }> {
  const stored = await readStored();
  return { enabled: stored.enabled && Boolean(stored.issuer && stored.clientId), buttonLabel: stored.buttonLabel };
}

// The discovery document, kept for the settings it was read with.
let discovered: { key: string; config: oidc.Configuration; at: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function configurationFor(stored: Pick<StoredSettings, "issuer" | "clientId" | "clientSecretEncrypted">) {
  const issuer = parseIssuer(stored.issuer);
  const key = `${stored.issuer}\n${stored.clientId}\n${stored.clientSecretEncrypted ?? ""}`;
  if (discovered && discovered.key === key && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.config;
  // The provider is reached from the server: not the cloud metadata endpoint, as for any connection.
  await resolveAllowedHost(issuer.hostname);
  const secret = stored.clientSecretEncrypted ? decryptPayload<string>(stored.clientSecretEncrypted) : undefined;
  let config: oidc.Configuration;
  try {
    config = await oidc.discovery(
      issuer,
      stored.clientId,
      secret,
      secret ? undefined : oidc.None(),
      issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests], timeout: 10 } : { timeout: 10 },
    );
  } catch (err) {
    throw new ApiError("SSO_DISCOVERY_FAILED", {
      message: `${issuerString(issuer)}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  discovered = { key, config, at: Date.now() };
  return config;
}

/** The console's "Tester": reads the provider's discovery document with the settings as they are (or as typed). */
export async function testSsoSettings(input: SsoSettingsInput): Promise<{ authorizationEndpoint: string }> {
  const before = await readStored();
  const issuer = issuerString(parseIssuer(input.issuer));
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  if (!clientId) throw new ApiError("SSO_SETTINGS_INVALID");
  const clientSecretEncrypted =
    input.clientSecret === null
      ? null
      : typeof input.clientSecret === "string" && input.clientSecret !== ""
        ? encryptPayload(input.clientSecret)
        : issuer === before.issuer && clientId === before.clientId
          ? before.clientSecretEncrypted
          : null;
  const config = await configurationFor({ issuer, clientId, clientSecretEncrypted });
  return { authorizationEndpoint: String(config.serverMetadata().authorization_endpoint ?? "") };
}

/** What the browser carries between the redirect to the provider and the way back, encrypted in a cookie. */
export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  next: string;
  remember: boolean;
  expiresAt: number;
}

export const PENDING_TTL_MS = 10 * 60 * 1000;

/** The redirect URI the login started with: the callback is checked against exactly that address. */
export function decodePendingRedirect(cookie: string | undefined): string {
  return decryptPayload<PendingLogin>(cookie ?? "").redirectUri;
}

export async function startLogin(
  redirectUri: string,
  next: string,
  remember: boolean,
): Promise<{ url: string; pending: string }> {
  const stored = await readStored();
  if (!stored.enabled || !stored.issuer || !stored.clientId) throw new ApiError("SSO_NOT_CONFIGURED");
  const config = await configurationFor(stored);
  const verifier = oidc.randomPKCECodeVerifier();
  const pending: PendingLogin = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    verifier,
    redirectUri,
    next,
    remember,
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: pending.state,
    nonce: pending.nonce,
  });
  return { url: url.href, pending: encryptPayload(pending) };
}

export type SsoRefusal =
  "expired" | "provider" | "no_email" | "unverified" | "domain" | "no_account" | "disabled" | "not_configured";

export class SsoLoginError extends Error {
  constructor(
    readonly reason: SsoRefusal,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

export interface SsoIdentity {
  issuer: string;
  subject: string;
  email: string;
  /** What the provider says of the address: `true` verified, `false` not, `null` nothing. */
  emailVerified: boolean | null;
  name: string | null;
}

/** The way back from the provider: the code exchanged, the ID token checked (signature, issuer, audience, nonce). */
export async function finishLogin(
  callbackUrl: URL,
  pendingCookie: string | undefined,
): Promise<{
  identity: SsoIdentity;
  pending: PendingLogin;
}> {
  let pending: PendingLogin;
  try {
    pending = decryptPayload<PendingLogin>(pendingCookie ?? "");
  } catch {
    throw new SsoLoginError("expired");
  }
  if (!pending?.state || pending.expiresAt < Date.now()) throw new SsoLoginError("expired");
  const stored = await readStored();
  if (!stored.enabled || !stored.issuer || !stored.clientId) throw new SsoLoginError("not_configured");
  const config = await configurationFor(stored);

  let claims: oidc.IDToken | undefined;
  try {
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch (err) {
    throw new SsoLoginError("provider", err instanceof Error ? err.message : String(err));
  }
  if (!claims?.sub) throw new SsoLoginError("provider", "no subject in the ID token");
  const email = normalizeEmail(claims.email);
  if (!email) throw new SsoLoginError("no_email");
  const emailVerified = typeof claims.email_verified === "boolean" ? claims.email_verified : null;
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 100) : null;
  return { identity: { issuer: stored.issuer, subject: claims.sub, email, emailVerified, name }, pending };
}

interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
  disabled_at: string | null;
}

/**
 * The NebulaDB user this identity logs in as. In order: the user it was
 * already tied to; the user with the same address (tied from now on); a new
 * user, when the settings allow it. The allowed domains and the verified
 * address apply to the last two — someone already tied keeps their access if
 * the list changes later.
 */
export async function resolveSsoUser(
  identity: SsoIdentity,
): Promise<{ user: UserRow; outcome: "known" | "linked" | "created" }> {
  const stored = await readStored();
  const linked = (await db
    .prepare(
      `SELECT u.id, u.email, u.is_admin, u.display_name, u.disabled_at
         FROM user_identities i JOIN users u ON u.id = i.user_id
        WHERE i.issuer = ? AND i.subject = ?`,
    )
    .get(identity.issuer, identity.subject)) as UserRow | undefined;
  if (linked) {
    if (linked.disabled_at) throw new SsoLoginError("disabled");
    await db
      .prepare("UPDATE user_identities SET last_login_at = utc_now(), email = ? WHERE issuer = ? AND subject = ?")
      .run(identity.email, identity.issuer, identity.subject);
    return { user: linked, outcome: "known" };
  }

  // The address decides which account this becomes: it has to be one the provider vouches for —
  // verified, or in a domain the administrator listed (a provider that never says, like Entra ID).
  const domain = identity.email.split("@")[1] ?? "";
  if (stored.allowedDomains.length > 0 && !stored.allowedDomains.includes(domain)) throw new SsoLoginError("domain");
  if (identity.emailVerified !== true && !stored.allowedDomains.includes(domain)) throw new SsoLoginError("unverified");

  const existing = (await db
    .prepare("SELECT id, email, is_admin, display_name, disabled_at FROM users WHERE email = ?")
    .get(identity.email)) as UserRow | undefined;
  let user = existing;
  let outcome: "linked" | "created" = "linked";
  if (user) {
    if (user.disabled_at) throw new SsoLoginError("disabled");
  } else {
    if (!stored.autoCreate) throw new SsoLoginError("no_account");
    const id = crypto.randomUUID();
    // No password: one is never asked of someone who signs in through the provider ("forgot password" can still set one).
    await db
      .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, ?)")
      .run(id, identity.email, "sso", identity.name);
    user = { id, email: identity.email, is_admin: 0, display_name: identity.name, disabled_at: null };
    outcome = "created";
  }
  await db
    .prepare(
      `INSERT INTO user_identities (issuer, subject, user_id, email, last_login_at) VALUES (?, ?, ?, ?, utc_now())
       ON CONFLICT (issuer, subject) DO NOTHING`,
    )
    .run(identity.issuer, identity.subject, user.id, identity.email);
  return { user, outcome };
}
