import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

test(
  "private database settings, global data workspace, monitoring and teams at invitation",
  { timeout: 90_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "athanor-private-ui-"));
    const filePath = join(dir, "sandbox.sqlite");
    const database = new Database(filePath);
    database.exec("CREATE TABLE examples (name TEXT); INSERT INTO examples VALUES ('Private data works');");
    database.close();
    const env = await startE2eEnvironment(4482);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await login(page, env.baseUrl);
      const team = await page.request.post(`${env.baseUrl}/api/teams`, { data: { name: "Équipe tests" } });
      assert.ok(team.ok(), await team.text());
      const navigation = page.getByRole("navigation", { name: "Navigation principale", exact: true });
      await navigation.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByPlaceholder("Adresse e-mail à inviter").waitFor();
      await page.getByText("Équipe tests", { exact: true }).click();
      await page.getByPlaceholder("Adresse e-mail à inviter").fill("new-member@example.com");
      await page.getByRole("button", { name: "Inviter", exact: true }).click();
      await page.getByText("new-member@example.com", { exact: true }).waitFor();
      const invitations = (await (await page.request.get(`${env.baseUrl}/api/invitations`)).json()) as {
        teams: { name: string }[];
      }[];
      assert.equal(invitations[0].teams[0].name, "Équipe tests");
      const members = page.getByRole("table", { name: "Utilisateurs", exact: true });
      assert.equal(await page.getByRole("table").count(), 1);
      const memberRow = members.locator('tr[data-email="new-member@example.com"]');
      await memberRow.getByText("En attente", { exact: true }).waitFor();
      await memberRow.getByRole("button", { name: "Copier le lien" }).waitFor();
      const rawInvitations = await (await page.request.get(env.baseUrl + "/api/invitations")).json();
      const accepted = await page.request.post(
        env.baseUrl + "/api/invitations/" + rawInvitations[0].token + "/accept",
        { data: { password: "correct horse battery staple e2e" } },
      );
      assert.ok(accepted.ok(), await accepted.text());
      await page.reload();
      await memberRow.getByText("Acceptée", { exact: true }).waitFor();
      assert.equal(await memberRow.count(), 1, "accepted invite and account become one row");
      assert.equal(await memberRow.getByRole("button", { name: "Copier le lien" }).count(), 0);
      await memberRow.getByRole("button", { name: "Réinitialiser le mot de passe" }).waitFor();
      await page.getByPlaceholder("Adresse e-mail à inviter").fill("revoked-member@example.com");
      await page.getByRole("button", { name: "Inviter", exact: true }).click();
      const revokedRow = members.locator('tr[data-email="revoked-member@example.com"]');
      await revokedRow.getByRole("button", { name: "Révoquer", exact: true }).click();
      await revokedRow.waitFor({ state: "detached" });
      const adminNav = page.getByRole("navigation", { name: "Console d'administration", exact: true });
      assert.equal(await adminNav.getByRole("button", { name: "Invitations", exact: true }).count(), 0);

      await page.getByRole("button", { name: "Paramètres du compte", exact: true }).click();
      await page.getByRole("button", { name: "Bases de données", exact: true }).click();
      await page.getByRole("button", { name: "Ajouter une base privée", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Mes bases privées", exact: true });
      await dialog.getByLabel("Nom", { exact: true }).fill("Sandbox personnelle");
      await dialog.getByRole("combobox", { name: "Moteur de base de données", exact: true }).click();
      await page.getByRole("option", { name: "SQLite", exact: true }).click();
      await dialog.getByPlaceholder("./data/app.sqlite").fill(filePath);
      await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByText("Sandbox personnelle", { exact: true }).waitFor();
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-database-settings.png") });

      await navigation.getByRole("button", { name: "Bases", exact: true }).click();
      await page.getByRole("button", { name: /Sandbox personnelle/ }).click();
      await page
        .getByRole("tab", { name: "Console SQL", exact: true })
        .waitFor()
        .catch(async (error) => {
          if (process.env.E2E_SHOTS)
            await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-database-error.png") });
          const list = await (await page.request.get(`${env.baseUrl}/api/me/connections`)).json();
          const response = await page.request.get(`${env.baseUrl}/api/connections/${list.personal[0].id}/overview`);
          throw new Error(`overview ${response.status()}: ${await response.text()}`, { cause: error });
        });
      await page.getByRole("tab", { name: "Console SQL", exact: true }).click();
      await page.getByRole("textbox", { name: "Console SQL", exact: true }).fill("SELECT * FROM examples");
      await page.getByRole("button", { name: "Exécuter", exact: true }).click();
      await page.getByRole("gridcell", { name: "Private data works", exact: true }).waitFor();
      assert.equal(await page.getByRole("tab", { name: "Santé", exact: true }).count(), 0);
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-database-workspace.png") });

      const shared = await page.request.post(`${env.baseUrl}/api/admin/connections`, {
        data: { name: "Base monitoring", engine: "sqlite", filePath },
      });
      assert.ok(shared.ok());
      await navigation.getByRole("button", { name: "Admin", exact: true }).click();
      await adminNav.getByRole("button", { name: "Connexions base de données", exact: true }).click();
      assert.equal(await page.getByText("Sandbox personnelle", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Monitoring", exact: true }).click();
      await page.getByRole("tab", { name: "Santé", exact: true }).waitFor();
      assert.equal(await page.getByRole("tab", { name: "Console SQL", exact: true }).count(), 0);
      assert.equal(await page.getByRole("tab", { name: "Explorateur", exact: true }).count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
