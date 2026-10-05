import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Personal database accounts, as far as a browser can go without a database
 * server: an administrator makes a connection ask each user for their own
 * account, the workspace then shows "Mon compte SQL" until one is given,
 * using the database without one is refused in words, and an account the
 * database does not accept is not kept.
 *
 * The accepted case needs a real PostgreSQL / MySQL login; it is covered on
 * the server (`connections/credentialRoutes.test.ts`) with that one step
 * replaced.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4425;

test(
  "personal accounts: asked for by the connection, missing until given, refused when the database says no",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `personal-accounts-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);

      const projectId = await page.evaluate(async () => {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Boutique" }),
        });
        return ((await created.json()) as { id: string }).id;
      });

      // --- Admin → Connexions: a connection nothing listens behind, with each person's own account ---
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      const form = page.getByRole("dialog");
      await form.getByPlaceholder("ex: Production DB").fill("Boutique live");
      const mode = form.getByRole("radiogroup", { name: "Compte utilisé pour se connecter" });
      assert.equal(await mode.getByRole("radio", { name: /Un compte partagé/ }).isChecked(), true);
      await mode.getByText("Le compte de chacun", { exact: true }).click();
      assert.equal(await mode.getByRole("radio", { name: /Le compte de chacun/ }).isChecked(), true);
      await snap("form");
      await form.getByRole("button", { name: "Enregistrer" }).click();
      await form.waitFor({ state: "detached" });

      // Pointed at a port nobody answers on, and attached to the project (the form's defaults are a local server).
      const connectionId = await page.evaluate(async (id) => {
        const json = { "content-type": "application/json" };
        const list = (await (await fetch("/api/admin/connections")).json()) as {
          connections: { id: string; authMode: string }[];
        };
        const connection = list.connections[0];
        if (connection.authMode !== "personal") throw new Error(`mode is ${connection.authMode}`);
        await fetch(`/api/admin/connections/${connection.id}`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ host: "127.0.0.1", port: 1, database: "shop", user: "service", password: "service" }),
        });
        await fetch(`/api/admin/connections/${connection.id}/projects`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ projectIds: [id] }),
        });
        return connection.id;
      }, projectId);

      // The administrator sees that nobody has given an account yet.
      await page.goto(env.baseUrl);
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("button", { name: "Modifier" }).first().click();
      await page.getByRole("dialog").getByTestId("credential-holders").getByText("Personne n'a encore donné").waitFor();
      await page.keyboard.press("Escape");

      // --- In the project: the account is missing, and the database says so when used ---
      await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
      const account = page.getByTestId("personal-account");
      await account.getByText("Mon compte SQL").waitFor();
      assert.equal(await account.getAttribute("data-account"), "");
      await page.getByRole("button", { name: "Vérifier les différences" }).click();
      await page
        .getByRole("dialog")
        .getByText(/La base « Boutique live » se connecte avec le compte de chacun/)
        .waitFor();
      await snap("refused");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });

      // --- An account the database does not accept is not kept ---
      await account.click();
      const dialog = page.getByRole("dialog", { name: "Mon compte sur « Boutique live »" });
      const save = dialog.getByRole("button", { name: "Essayer et enregistrer" });
      assert.equal(await save.isDisabled(), true, "nothing to try without a name and a password");
      await dialog.getByLabel("Nom du compte sur la base").fill("ada");
      await dialog.getByLabel("Mot de passe", { exact: true }).fill("ada-password");
      await save.click();
      await dialog.getByRole("alert").filter({ hasText: "La base a refusé ce compte" }).waitFor();
      await snap("rejected");
      const stored = await page.evaluate(async (id) => {
        const res = await fetch(`/api/connections/${id}/credentials`);
        return (await res.json()) as { authMode: string; username: string | null };
      }, connectionId);
      assert.deepEqual(stored, { authMode: "personal", username: null, updatedAt: null });
      await dialog.getByRole("button", { name: "Annuler" }).click();
      await dialog.waitFor({ state: "detached" });

      // --- Settings → Mes comptes SQL: the same connection, with the account still missing ---
      await page.goto(env.baseUrl);
      await page.locator('[data-tooltip="Paramètres du compte"]').click();
      const row = page.getByTestId("sql-account-row");
      await row.getByText("Boutique live").waitFor();
      assert.equal(await row.getAttribute("data-account"), "");
      await row.getByRole("button", { name: "Renseigner" }).click();
      await page.getByRole("dialog", { name: "Mon compte sur « Boutique live »" }).waitFor();
      await snap("settings");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);

      // --- Back to one shared account: the button goes away ---
      await page.evaluate(async (id) => {
        await fetch(`/api/admin/connections/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ authMode: "shared" }),
        });
      }, connectionId);
      await page.reload();
      await page.getByRole("button", { name: "Vérifier les différences" }).waitFor();
      assert.equal(await account.count(), 0);

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
