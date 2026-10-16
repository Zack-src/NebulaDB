import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("oidc");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("./password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";
const CLIENT_ID = "nebuladb";
const CLIENT_SECRET = "s3cret";

/**
 * A provider of the test's own: discovery, keys, and a token endpoint that
 * checks the client secret and the PKCE verifier, then signs an ID token with
 * whatever claims the test chose for that code.
 */
async function fakeProvider() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { claims: Record<string, unknown>; challenge: string; nonce: string }>();
  let issuer = "";
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
    }
    if (url.pathname.endsWith("/jwks")) return json(200, { keys: [jwk] });
    if (url.pathname.endsWith("/token")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      // client_secret_basic or client_secret_post, whichever the client chose.
      const basic = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
      const [id, secret] = req.headers.authorization
        ? basic.split(":").map(decodeURIComponent)
        : [form.get("client_id"), form.get("client_secret")];
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json(401, { error: "invalid_client" });
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!grant || grant.challenge !== challenge) return json(400, { error: "invalid_grant" });
      const idToken = await new jose.SignJWT({ nonce: grant.nonce, ...grant.claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return json(200, { access_token: "at", token_type: "Bearer", id_token: idToken, expires_in: 300 });
    }
    json(404, {});
  };
  const server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/test`;
  return {
    issuer,
    /** What the provider does once the person has signed in there: a code for these claims. */
    approve(authorizeUrl: string, claims: Record<string, unknown>): string {
      const url = new URL(authorizeUrl);
      const code = randomUUID();
      codes.set(code, {
        claims,
        challenge: url.searchParams.get("code_challenge")!,
        nonce: url.searchParams.get("nonce")!,
      });
      return `?code=${code}&state=${url.searchParams.get("state")}`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const provider = await fakeProvider();
const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
  await provider.close();
});

async function adminCookie() {
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 1)")
    .run(randomUUID(), email, await hashPassword(PASSWORD));
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

async function configure(cookie: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "PUT",
    url: "/api/admin/settings/sso",
    headers: headers({ cookie }),
    payload: {
      enabled: true,
      issuer: provider.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      buttonLabel: "Keycloak",
      ...extra,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

/** The whole round trip as a browser makes it; returns where it ends and the session cookie, if any. */
async function signIn(claims: Record<string, unknown>, next = "/project/abc") {
  const start = await app.inject({
    method: "GET",
    url: `/api/auth/sso/start?next=${encodeURIComponent(next)}`,
    headers: headers(),
  });
  assert.equal(start.statusCode, 302, start.body);
  const pending = start.cookies.find((c) => c.name === "nebuladb_sso")!;
  const back = await app.inject({
    method: "GET",
    url: `/api/auth/sso/callback${provider.approve(start.headers.location as string, claims)}`,
    headers: headers({ cookie: `nebuladb_sso=${pending.value}` }),
  });
  assert.equal(back.statusCode, 302, back.body);
  const session = back.cookies.find((c) => c.name === "nebuladb_sid" && c.value);
  return { location: back.headers.location as string, session: session ? `nebuladb_sid=${session.value}` : null };
}

async function me(session: string | null) {
  const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers({ cookie: session ?? "" }) });
  return res.statusCode === 200 ? (res.json() as { email: string; isAdmin: boolean }) : null;
}

test("SSO settings: the secret is never sent back, the login page learns the button, the provider can be tested", async () => {
  const cookie = await adminCookie();
  const saved = await configure(cookie);
  assert.equal(saved.settings.hasClientSecret, true);
  assert.equal(JSON.stringify(saved).includes(CLIENT_SECRET), false);
  assert.equal(saved.redirectUri, `http://${HOST}/api/auth/sso/callback`);

  const features = await app.inject({ method: "GET", url: "/api/auth/features", headers: headers() });
  assert.deepEqual(features.json().sso, { enabled: true, buttonLabel: "Keycloak" });

  const tested = await app.inject({
    method: "POST",
    url: "/api/admin/settings/sso/test",
    headers: headers({ cookie }),
    payload: { issuer: provider.issuer, clientId: CLIENT_ID },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  assert.equal(tested.json().authorizationEndpoint, `${provider.issuer}/authorize`);

  const unreachable = await app.inject({
    method: "POST",
    url: "/api/admin/settings/sso/test",
    headers: headers({ cookie }),
    payload: { issuer: "http://127.0.0.1:1/nothing", clientId: CLIENT_ID },
  });
  assert.equal(unreachable.json().code, "SSO_DISCOVERY_FAILED");

  for (const issuer of ["http://idp.example.com", "ftp://x", "not a url"]) {
    const refused = await app.inject({
      method: "PUT",
      url: "/api/admin/settings/sso",
      headers: headers({ cookie }),
      payload: { enabled: true, issuer, clientId: CLIENT_ID },
    });
    assert.equal(refused.json().code, "SSO_SETTINGS_INVALID", issuer);
  }
  const member = await app.inject({
    method: "GET",
    url: "/api/admin/settings/sso",
    headers: headers(),
  });
  assert.equal(member.statusCode, 401);
});

test("SSO login: an existing account by verified address, then always by the provider's identifier", async () => {
  const cookie = await adminCookie();
  await configure(cookie, { autoCreate: false, allowedDomains: [] });
  const email = `ada-${randomUUID().slice(0, 6)}@example.com`;
  const userId = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
    .run(userId, email, await hashPassword(PASSWORD));
  const subject = randomUUID();

  const first = await signIn({ sub: subject, email, email_verified: true });
  assert.equal(first.location, "/project/abc");
  assert.equal((await me(first.session))?.email, email);

  // The address changed at the provider: the identifier still finds the account.
  const again = await signIn({ sub: subject, email: `renamed-${email}`, email_verified: true });
  assert.equal((await me(again.session))?.email, email);

  // An address the provider does not vouch for takes over nobody.
  const unverified = await signIn({ sub: randomUUID(), email, email_verified: false });
  assert.equal(unverified.session, null);
  assert.equal(unverified.location, "/?sso=unverified");
  const silent = await signIn({ sub: randomUUID(), email });
  assert.equal(silent.location, "/?sso=unverified");

  // Nobody with that address, and no creation allowed.
  const stranger = await signIn({ sub: randomUUID(), email: "nobody@example.com", email_verified: true });
  assert.equal(stranger.location, "/?sso=no_account");

  // A disabled account stays shut.
  await db.prepare("UPDATE users SET disabled_at = utc_now() WHERE id = ?").run(userId);
  const disabled = await signIn({ sub: subject, email, email_verified: true });
  assert.equal(disabled.location, "/?sso=disabled");
});

test("SSO login: accounts created on first sign-in, only in the allowed domains, never administrators", async () => {
  const cookie = await adminCookie();
  await configure(cookie, { autoCreate: true, allowedDomains: ["Corp.example", "@lab.example"] });
  const settings = await app.inject({ method: "GET", url: "/api/admin/settings/sso", headers: headers({ cookie }) });
  assert.deepEqual(settings.json().settings.allowedDomains, ["corp.example", "lab.example"]);

  // A listed domain is trusted even when the provider says nothing about verification (Entra ID).
  const email = `grace-${randomUUID().slice(0, 6)}@corp.example`;
  const created = await signIn({ sub: randomUUID(), email, name: "Grace Hopper" }, "//evil.example/x");
  assert.equal(created.location, "/", "an outside address is never followed");
  const account = await me(created.session);
  assert.equal(account?.email, email);
  assert.equal(account?.isAdmin, false);
  const row = (await db.prepare("SELECT display_name, password_hash FROM users WHERE email = ?").get(email)) as {
    display_name: string;
    password_hash: string;
  };
  assert.equal(row.display_name, "Grace Hopper");
  // No password works for that account.
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: "sso" },
  });
  assert.equal(login.statusCode, 401);

  const outside = await signIn({ sub: randomUUID(), email: "eve@elsewhere.example", email_verified: true });
  assert.equal(outside.location, "/?sso=domain");
});

test("SSO callback: a forged state, a replayed code or no pending cookie are refused", async () => {
  const cookie = await adminCookie();
  await configure(cookie, { autoCreate: true, allowedDomains: [] });
  const start = await app.inject({ method: "GET", url: "/api/auth/sso/start", headers: headers() });
  const pending = start.cookies.find((c) => c.name === "nebuladb_sso")!.value;
  const query = provider.approve(start.headers.location as string, {
    sub: randomUUID(),
    email: "x@example.com",
    email_verified: true,
  });

  const noCookie = await app.inject({ method: "GET", url: `/api/auth/sso/callback${query}`, headers: headers() });
  assert.equal(noCookie.headers.location, "/?sso=expired");

  const forged = await app.inject({
    method: "GET",
    url: `/api/auth/sso/callback${query.replace(/state=[^&]+/, "state=forged")}`,
    headers: headers({ cookie: `nebuladb_sso=${pending}` }),
  });
  assert.equal(forged.headers.location, "/?sso=provider");

  const providerError = await app.inject({
    method: "GET",
    url: "/api/auth/sso/callback?error=access_denied",
    headers: headers({ cookie: `nebuladb_sso=${pending}` }),
  });
  assert.equal(providerError.headers.location, "/?sso=provider");
});

test("SSO off: the button is not offered and the start sends back to the login page", async () => {
  const cookie = await adminCookie();
  await configure(cookie, { enabled: false });
  const features = await app.inject({ method: "GET", url: "/api/auth/features", headers: headers() });
  assert.equal(features.json().sso.enabled, false);
  const start = await app.inject({ method: "GET", url: "/api/auth/sso/start", headers: headers() });
  assert.equal(start.headers.location, "/?sso=not_configured");
});
