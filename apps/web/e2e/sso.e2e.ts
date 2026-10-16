import { test } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Single sign-on, the whole way a browser goes: an administrator fills in
 * Admin → Connexion unique (SSO) and tests the provider; someone else then
 * clicks "Se connecter avec …" on the login page, goes through the provider
 * (the test's own, which signs in whoever the test chose without asking) and
 * lands in NebulaDB with an account created for them. A refused address comes
 * back to the login page with the reason in words.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4428;
const CLIENT_ID = "nebuladb-e2e";
const CLIENT_SECRET = "e2e-secret";

async function provider() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { challenge: string; nonce: string; claims: Record<string, unknown> }>();
  /** Who "signs in" at the provider next. */
  let next: Record<string, unknown> = {};
  let issuer = "";
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith("/.well-known/openid-configuration"))
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname.endsWith("/jwks")) return json(200, { keys: [jwk] });
    if (url.pathname.endsWith("/authorize")) {
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge")!,
        nonce: url.searchParams.get("nonce")!,
        claims: next,
      });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname.endsWith("/token")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const basic = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
      const [id, secret] = req.headers.authorization
        ? basic.split(":").map(decodeURIComponent)
        : [form.get("client_id"), form.get("client_secret")];
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json(401, { error: "invalid_client" });
      const grant = codes.get(form.get("code") ?? "");
      const challenge = crypto
        .createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
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
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/e2e`;
  return {
    issuer,
    signInAs: (claims: Record<string, unknown>) => (next = claims),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test(
  "SSO: set up in the admin console, signed in through the provider, refused with a reason",
  { timeout: 120_000 },
  async () => {
    const idp = await provider();
    const env = await startE2eEnvironment(PORT);
    try {
      const admin = await env.browser.newPage({ viewport: { width: 1400, height: 1000 } });
      admin.setDefaultTimeout(15_000);
      const errors: string[] = [];
      admin.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (page: typeof admin, name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: `${process.env.E2E_SHOTS}/sso-${++shot}-${name}.png` });
      };
      await login(admin, env.baseUrl);

      // --- Admin → Connexion unique (SSO) ---
      await admin.getByRole("button", { name: "Admin", exact: true }).click();
      await admin.getByRole("button", { name: "Connexion unique (SSO)" }).click();
      const settings = admin.getByTestId("sso-settings");
      await settings.getByText(`${env.baseUrl}/api/auth/sso/callback`).waitFor();
      await settings.getByLabel("URL de l'émetteur (issuer)").fill(idp.issuer);
      await settings.getByLabel("Identifiant du client").fill(CLIENT_ID);
      await settings.getByLabel("Secret du client").fill(CLIENT_SECRET);
      await settings.getByLabel("Nom affiché sur le bouton de connexion").fill("Keycloak");
      await settings.getByLabel("Domaines e-mail autorisés").fill("acme.test");
      await settings.getByText("Créer le compte à la première connexion", { exact: true }).click();
      await settings.getByText("Proposer la connexion SSO", { exact: true }).click();
      await settings.getByRole("button", { name: "Tester le fournisseur" }).click();
      await settings.getByRole("status").getByText(`${idp.issuer}/authorize`, { exact: false }).waitFor();
      await settings.getByRole("button", { name: "Enregistrer" }).click();
      await admin.getByText("Réglages SSO enregistrés").waitFor();
      await snap(admin, "settings");
      // The secret is stored, never shown back.
      await admin.reload();
      await admin.getByRole("button", { name: "Admin", exact: true }).click();
      await admin.getByRole("button", { name: "Connexion unique (SSO)" }).click();
      const secret = admin.getByTestId("sso-settings").getByLabel("Secret du client");
      assert.equal(await secret.inputValue(), "");
      assert.equal(await secret.getAttribute("placeholder"), "••••••••");

      // --- Someone else, signed out, goes through the provider ---
      const visitor = await (await env.browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
      visitor.setDefaultTimeout(15_000);
      visitor.on("pageerror", (err) => errors.push(String(err)));
      idp.signInAs({ sub: "u-1", email: "grace@acme.test", name: "Grace Hopper" });
      await visitor.goto(env.baseUrl);
      const button = visitor.getByRole("link", { name: "Se connecter avec Keycloak" });
      await button.waitFor();
      await snap(visitor, "login");
      await button.click();
      await visitor.getByRole("button", { name: "Nouveau projet" }).first().waitFor();
      const me = await visitor.evaluate(async () => (await fetch("/api/auth/me")).json());
      assert.equal(me.email, "grace@acme.test");
      assert.equal(me.isAdmin, false);
      assert.equal(new URL(visitor.url()).pathname, "/");
      await snap(visitor, "signed-in");

      // --- An address outside the allowed domains comes back with the reason ---
      const outsider = await (await env.browser.newContext()).newPage();
      outsider.setDefaultTimeout(15_000);
      outsider.on("pageerror", (err) => errors.push(String(err)));
      idp.signInAs({ sub: "u-2", email: "eve@elsewhere.test", email_verified: true });
      await outsider.goto(env.baseUrl);
      await outsider.getByRole("link", { name: "Se connecter avec Keycloak" }).click();
      await outsider.getByText("Votre adresse e-mail n'appartient pas à un domaine autorisé").waitFor();
      assert.equal(new URL(outsider.url()).pathname + new URL(outsider.url()).search, "/");
      await snap(outsider, "refused");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
      await idp.close();
    }
  },
);
