import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import ssh2 from "ssh2";
import type { Locator, Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin → Connexions → the "Sécurité" tab: a PostgreSQL connection reached
 * through an SSH server, whose host key the first test fills in, then TLS with
 * an authority of its own. The SSH server is the test's own (ssh2), the
 * database the throwaway PostgreSQL of `docker-compose.test.yml`, seen from
 * the SSH server as `localhost:55432`.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4427;
const pg = {
  host: process.env.NEBULADB_TEST_PG_HOST || "localhost",
  port: Number(process.env.NEBULADB_TEST_PG_PORT || 55432),
  database: process.env.NEBULADB_TEST_PG_DATABASE || "nebuladb_test",
  user: process.env.NEBULADB_TEST_PG_USER || "nebuladb_test",
  password: process.env.NEBULADB_TEST_PG_PASSWORD || "nebuladb_test",
};
const CA = readFileSync(new URL("../../server/test-fixtures/tls/ca.crt", import.meta.url), "utf8");

async function sshServer() {
  const hostKey = ssh2.utils.generateKeyPairSync("ed25519");
  const forwarded: string[] = [];
  const server = new ssh2.Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.username === "tunnel" && ctx.method === "password" && ctx.password === "secret") return ctx.accept();
      ctx.reject(["password"]);
    });
    client.on("ready", () =>
      client.on("tcpip", (accept, _reject, info) => {
        forwarded.push(`${info.destIP}:${info.destPort}`);
        const channel = accept();
        const upstream = net.connect(info.destPort, info.destIP);
        channel.pipe(upstream).pipe(channel);
        upstream.on("error", () => channel.close());
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { createHash } = await import("node:crypto");
  const publicKey = (ssh2.utils.parseKey(hostKey.public) as ssh2.ParsedKey).getPublicSSH();
  return {
    port: (server.address() as net.AddressInfo).port,
    fingerprint: `SHA256:${createHash("sha256").update(publicKey).digest("base64").replace(/=+$/, "")}`,
    forwarded,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface Saved {
  id: string;
  name: string;
  ssl?: boolean;
  sslVerify?: boolean;
  sslCa?: string;
  sshTunnel?: { host: string; port: number; user: string; hasPassword: boolean; hostKeyFingerprint?: string };
}

async function saved(page: Page, name: string): Promise<Saved> {
  const all = await page.evaluate(async () => {
    const response = await fetch("/api/admin/connections");
    return ((await response.json()) as { connections: Saved[] }).connections;
  });
  const found = all.find((connection) => connection.name === name);
  assert.ok(found);
  return found;
}

const fieldUnder = (dialog: Locator, label: string) => dialog.locator(`label:text-is("${label}") + input`);

test(
  "connection security: through an SSH tunnel, host key filled by the first test, TLS authority saved",
  { timeout: 120_000 },
  async (t) => {
    const ssh = await sshServer();
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: `${process.env.E2E_SHOTS}/connection-security-${++shot}-${name}.png` });
      };
      await login(page, env.baseUrl);

      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      const dialog = page.getByRole("dialog", { name: "Nouvelle connexion" });
      await dialog.getByPlaceholder("ex: Production DB").fill("Derrière le bastion");
      // As the SSH server sees the database.
      await fieldUnder(dialog, "Hôte").fill(pg.host);
      await dialog.getByRole("spinbutton", { name: "Port" }).fill(String(pg.port));
      await fieldUnder(dialog, "Base de données").fill(pg.database);
      await dialog.getByText("Un compte partagé", { exact: true }).click();
      await fieldUnder(dialog, "Utilisateur").fill(pg.user);
      await fieldUnder(dialog, "Mot de passe").fill(pg.password);

      await dialog.getByRole("tab", { name: "Sécurité" }).click();
      const security = dialog.getByRole("tabpanel", { name: "Sécurité" });
      await security.getByText("Passer par un serveur SSH", { exact: true }).click();
      await security.getByLabel("Serveur SSH", { exact: true }).fill("127.0.0.1");
      await security.getByRole("spinbutton", { name: "Port" }).fill(String(ssh.port));
      await security.getByLabel("Utilisateur SSH", { exact: true }).fill("tunnel");
      await security.getByLabel("Mot de passe", { exact: true }).fill("secret");
      const fingerprint = security.getByLabel("Empreinte de la clé d'hôte");
      assert.equal(await fingerprint.inputValue(), "");
      await snap("ssh");

      await dialog.getByRole("button", { name: "Tester la connexion" }).click();
      const outcome = dialog.getByTestId("connection-test-result");
      await outcome.waitFor();
      const outcomeText = (await outcome.textContent()) ?? "";
      if (!/Connexion établie/.test(outcomeText)) {
        if (/ECONNREFUSED/.test(outcomeText)) return t.skip(`no Postgres test container: ${outcomeText}`);
        assert.fail(outcomeText);
      }
      assert.deepEqual(ssh.forwarded, [`${pg.host}:${pg.port}`]);
      await dialog.getByTestId("ssh-fingerprint-seen").getByText(ssh.fingerprint, { exact: false }).waitFor();
      await dialog.getByRole("tab", { name: "Sécurité" }).click();
      assert.equal(await fingerprint.inputValue(), ssh.fingerprint);
      await snap("tested");

      // TLS with the connection's own authority: ticking the authority turns the check on.
      await security.getByText("Activer SSL / TLS", { exact: true }).click();
      await security.getByLabel("Autorité de certification (PEM)").fill(CA);
      assert.equal(await security.getByRole("checkbox", { name: /Vérifier le certificat/ }).isChecked(), true);
      await snap("tls");
      await dialog.getByRole("button", { name: "Enregistrer" }).click();
      await dialog.waitFor({ state: "detached" });

      const connection = await saved(page, "Derrière le bastion");
      assert.equal(connection.ssl, true);
      assert.equal(connection.sslVerify, true);
      assert.equal(connection.sslCa?.trim(), CA.trim());
      assert.deepEqual(connection.sshTunnel, {
        host: "127.0.0.1",
        port: ssh.port,
        user: "tunnel",
        hasPassword: true,
        hasPrivateKey: false,
        hostKeyFingerprint: ssh.fingerprint,
      });

      // Reopened: the password is not shown back, and a test without TLS still uses the stored one.
      await page.getByRole("button", { name: "Modifier" }).first().click();
      const editing = page.getByRole("dialog", { name: "Modifier la connexion" });
      await editing.getByRole("tab", { name: "Sécurité" }).click();
      const editSecurity = editing.getByRole("tabpanel", { name: "Sécurité" });
      const sshPassword = editSecurity.getByLabel("Mot de passe", { exact: true });
      assert.equal(await sshPassword.inputValue(), "");
      assert.equal(await sshPassword.getAttribute("placeholder"), "••••••••");
      await editSecurity.getByText("Activer SSL / TLS", { exact: true }).click();
      await editing.getByRole("button", { name: "Tester la connexion" }).click();
      await editing.getByText("Connexion établie avec succès", { exact: false }).waitFor();
      await snap("retested");
      await editing.getByRole("button", { name: "Enregistrer" }).click();
      await editing.waitFor({ state: "detached" });
      const after = await saved(page, "Derrière le bastion");
      assert.equal(after.ssl, false);
      assert.equal(after.sshTunnel?.hasPassword, true);

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
      await ssh.close();
    }
  },
);
