import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Deployment stages: an administrator shapes the chain in Admin →
 * Environnements, a connection is put on a stage from its form, the
 * production stage shows red in the workspace, and deploying to it asks for
 * the connection's name before anything runs.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4411;

test(
  "environments: chain in the admin, a stage on a connection, production deploy confirmed by name",
  { timeout: 90_000 },
  async () => {
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-e2e-env-")), "shop.sqlite");
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `environments-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);

      // --- Admin → Environnements ---
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Environnements" }).click();
      const chain = page.getByLabel("Chaîne de déploiement");
      const chainNames = async () =>
        (await chain.locator("[data-production], span.rounded-full").allInnerTexts())
          .map((s) => s.trim())
          .filter(Boolean);
      await chain.getByText("Prod", { exact: true }).waitFor();
      assert.deepEqual(await chainNames(), ["DEV", "STAGING", "PROD"]);

      await page.getByPlaceholder("Nouvelle étape (ex. Recette)").fill("Recette");
      await page.getByRole("button", { name: "Ajouter une étape" }).click();
      await chain.getByText("Recette", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Avancer Recette" }).click();
      await page.waitForFunction(() => {
        const label = document.querySelector('[aria-label="Chaîne de déploiement"]');
        return (
          label?.textContent?.replace(/\s+/g, " ").includes("Recette") &&
          label.textContent.indexOf("Recette") < label.textContent.indexOf("Prod")
        );
      });
      assert.deepEqual(await chainNames(), ["DEV", "STAGING", "RECETTE", "PROD"]);
      await snap("admin-chain");

      // --- A connection on the production stage ---
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByPlaceholder("ex: Production DB").fill("Boutique live");
      await dialog.locator("select").first().selectOption("sqlite");
      await dialog.getByPlaceholder("./data/app.sqlite").fill(targetFile);
      await dialog.getByRole("combobox", { name: "Environnement" }).click();
      await page.getByRole("option", { name: /^Prod/ }).click();
      await dialog.getByRole("button", { name: "Enregistrer" }).click();
      await page.getByText("Boutique live", { exact: true }).waitFor();
      const listBadge = page.locator('[data-production="true"]').filter({ hasText: "Prod" });
      await listBadge.waitFor();
      await snap("connection-list");

      // A project with one table, using that connection.
      const projectId = await page.evaluate(async () => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Boutique" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ source: "Table products {\n  id int [pk]\n}\n" }),
        });
        const list = (await (await fetch("/api/admin/connections")).json()) as { connections: { id: string }[] };
        await fetch(`/api/admin/connections/${list.connections[0].id}/projects`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ projectIds: [id] }),
        });
        return id;
      });

      // --- The workspace shows the stage in red; deploying asks for the name ---
      await page.goto(`${env.baseUrl}/project/${projectId}`);
      await page.locator('[data-production="true"]').filter({ hasText: "Prod" }).first().waitFor();
      await page.getByRole("button", { name: "Déployer", exact: true }).first().click();
      const modal = page.getByRole("dialog").first();
      await modal.getByRole("button", { name: "Prévisualiser le SQL" }).click();
      await modal.getByRole("button", { name: "Appliquer les modifications en base" }).click();

      const confirm = page.getByRole("dialog", { name: "Déployer sur « Boutique live » ?" });
      await confirm.waitFor();
      const go = confirm.getByRole("button", { name: "Appliquer les modifications en base" });
      assert.equal(await go.isDisabled(), true, "nothing runs before the name is typed");
      await confirm.getByRole("textbox").fill("Boutique");
      assert.equal(await go.isDisabled(), true);
      await confirm.getByRole("textbox").fill("Boutique live");
      await snap("confirm");
      await go.click();
      await confirm.waitFor({ state: "detached" });

      const history = await page.evaluate(async (id) => {
        const list = (await (await fetch(`/api/projects/${id}/connections`)).json()) as {
          connections: { id: string }[];
        };
        const res = await fetch(`/api/projects/${id}/connections/${list.connections[0].id}/history`);
        return ((await res.json()) as { history: { success: boolean; environment?: string }[] }).history;
      }, projectId);
      assert.deepEqual(
        history.map((entry) => [entry.success, entry.environment]),
        [[true, "Prod"]],
      );
      await snap("deployed");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
