import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * A deployment that loses data: the plan says how many values a dropped
 * column holds (a count, no rows), "cancel / handle manually" really stops
 * the deployment, the SQL preview follows the answers, and the accepted loss
 * is kept in the history with the reason given.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4412;

test(
  "deployment risks: counted, cancel blocks, accepted loss recorded with its reason",
  { timeout: 90_000 },
  async () => {
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-e2e-risks-")), "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, note TEXT);
    INSERT INTO customers (name, note) VALUES ('Ada', 'secret one'), ('Linus', 'secret two'), ('Grace', NULL);
  `);
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `risks-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);

      // The schema no longer has `note`; the database still holds two values in it.
      const projectId = await page.evaluate(
        async ({ filePath }) => {
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
            body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  name text\n}\n" }),
          });
          await fetch(`/api/projects/${id}/connections`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
          });
          return id;
        },
        { filePath: targetFile },
      );

      await page.goto(`${env.baseUrl}/project/${projectId}`);
      await page.getByRole("button", { name: "Déployer", exact: true }).first().click();
      const modal = page.getByRole("dialog").first();
      await modal.getByText("2 ligne(s) concernée(s)").waitFor();
      assert.equal(await modal.getByText("secret one").count(), 0, "no row data in the plan");
      await snap("plan");

      // "Cancel / handle manually" stops the deployment.
      await modal.getByText("Annuler / Gérer manuellement").click();
      await modal.getByRole("button", { name: "Prévisualiser le SQL" }).click();
      await modal.getByRole("alert").waitFor();
      assert.equal(await modal.getByRole("button", { name: "Appliquer les modifications en base" }).isDisabled(), true);

      // Accept the loss: the preview now drops the column; a reason is asked for.
      await modal.getByRole("button", { name: "Retour" }).click();
      await modal.getByText("Supprimer définitivement les données").click();
      await modal.getByRole("button", { name: "Prévisualiser le SQL" }).click();
      const sql = await modal.locator("textarea").first().inputValue();
      assert.match(sql, /DROP COLUMN "note"|"note"/, sql);
      await modal.getByRole("textbox", { name: /Pourquoi ces pertes/ }).fill("notes moved to the CRM");
      await snap("accepted");
      await modal.getByRole("button", { name: "Appliquer les modifications en base" }).click();
      await modal
        .getByText(/succès|réussi/i)
        .first()
        .waitFor();

      // The history keeps the decision and its reason.
      await modal.getByRole("button", { name: "Historique" }).click();
      await modal.getByText("Risques de ce déploiement").waitFor();
      await modal.getByText("« notes moved to the CRM »").waitFor();
      await modal.getByText(/colonne supprimée/).waitFor();
      await snap("history");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
