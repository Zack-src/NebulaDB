import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Backups, from the console's "Sauvegardes" tab: one is taken, the data is
 * damaged, the backup is restored after the database's name is retyped, and
 * the state from just before the restore is itself kept.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4416;

test("backups: back up, lose rows, restore them", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-e2e-backups-")), "shop.sqlite");
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `backups-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

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
          body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  name varchar\n}\n" }),
        });
        const connection = await fetch(`/api/projects/${id}/connections`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
        });
        const connId = ((await connection.json()) as { connection: { id: string } }).connection.id;
        await fetch(`/api/projects/${id}/connections/${connId}/apply-deployment`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ resolutions: {} }),
        });
        return id;
      },
      { filePath: targetFile },
    );
    const rows = () => {
      const target = new Database(targetFile);
      try {
        return target.prepare("SELECT name FROM customers ORDER BY id").pluck().all() as string[];
      } finally {
        target.close();
      }
    };
    const write = (sql: string) => {
      const target = new Database(targetFile);
      target.exec(sql);
      target.close();
    };
    write("INSERT INTO customers (id, name) VALUES (1, 'Ada'), (2, 'Grace');");

    await page.goto(`${env.baseUrl}/project/${projectId}/data`);
    await page.getByRole("tab", { name: "Sauvegardes", exact: true }).click();
    const panel = page.getByTestId("backups");
    await panel.getByText("Aucune sauvegarde de cette base.").waitFor();
    await panel.getByRole("button", { name: "Sauvegarder maintenant" }).click();
    const done = panel.locator('tr[data-status="done"]');
    await done.first().waitFor();
    await done.first().getByText("1 table · 2 lignes").waitFor();
    assert.equal(await done.first().getAttribute("data-trigger"), "manual");
    await snap("taken");

    // The data is damaged.
    write("DELETE FROM customers WHERE id = 1; UPDATE customers SET name = 'oops';");
    assert.deepEqual(rows(), ["oops"]);

    await done.first().getByRole("button", { name: "Restaurer" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Restaurer" });
    assert.equal(await confirm.isDisabled(), true, "nothing happens before the name is retyped");
    await dialog.getByRole("textbox").fill("Base boutique");
    await snap("restore-dialog");
    await confirm.click();
    await dialog.getByTestId("restore-result").getByText("Restauration terminée.").waitFor();
    await dialog.getByText("customers : 1 supprimées, 2 insérées").waitFor();
    assert.deepEqual(rows(), ["Ada", "Grace"]);
    await snap("restored");
    await dialog.getByRole("button", { name: "Fermer" }).last().click();

    // What was there just before the restore is in the list too.
    const safety = panel.locator('tr[data-trigger="pre-restore"]');
    await safety.waitFor();
    await safety.getByText("1 table · 1 ligne").waitFor();

    // Deleting asks first.
    await safety.getByRole("button", { name: "Supprimer", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
    await safety.waitFor({ state: "detached" });
    assert.equal(await panel.locator("tbody tr").count(), 1);

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
