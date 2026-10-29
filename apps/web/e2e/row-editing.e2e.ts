import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Editing rows from the explorer's grid on a SQLite database: change a cell
 * and add a row, review the statements the server will run, apply them. The
 * rules (rights, stale rows, row counts, rollback) are covered in
 * `apps/server/src/modules/dbAdmin/rowEdits.test.ts`; this checks the wiring.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each stage.
 */

const PORT = Number(process.env.E2E_PORT) || 4460;

test(
  "an administrator edits a cell and adds a row, reviews the SQL, and applies it",
  { timeout: 120_000 },
  async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "nebuladb-e2e-rows-"));
    const targetFile = join(targetDir, "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT);
    INSERT INTO customers (name, note) VALUES ('Ada', 'first'), ('Linus', NULL);
  `);
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `row-editing-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);
      // A private database of the signed-in account, opened from "Bases": the console a member with
      // `write` gets, so the apply also carries the confirmation the server asks of one.
      const status = await page.evaluate(async (filePath) => {
        const created = await fetch("/api/me/connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
        });
        return created.status;
      }, targetFile);
      assert.equal(status, 201);

      await page.goto(`${env.baseUrl}/#bases`);
      await page.getByRole("button", { name: /Base boutique/ }).click();
      await page.getByRole("button", { name: /customers/ }).click();
      await page.getByRole("gridcell", { name: "Linus" }).waitFor();

      // Change Linus's note from NULL to an empty string — not the same thing.
      await page.getByRole("gridcell", { name: "Linus" }).dblclick();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Saisir une valeur" }).click();
      await dialog.getByRole("button", { name: "Garder" }).click();
      await dialog.waitFor({ state: "detached" });
      // And Ada's name.
      await page.getByRole("gridcell", { name: "Ada" }).dblclick();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "name" }).fill("Ada L.");
      await dialog.getByRole("button", { name: "Garder" }).click();
      await dialog.waitFor({ state: "detached" });
      // A new row: the key is left to the database.
      await page.getByRole("button", { name: "Ajouter une ligne" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "name" }).fill("Grace");
      await dialog.getByRole("button", { name: "Garder" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByText("3 modification(s) en attente").waitFor();
      await snap("pending");

      await page.getByRole("button", { name: "Vérifier et appliquer" }).click();
      dialog = page.getByRole("dialog");
      const preview = dialog.locator("pre");
      await preview.filter({ hasText: "INSERT" }).waitFor();
      assert.equal(
        await preview.textContent(),
        [
          `UPDATE "customers" SET "note" = '' WHERE "id" = 2;`,
          `UPDATE "customers" SET "name" = 'Ada L.' WHERE "id" = 1;`,
          `INSERT INTO "customers" ("name") VALUES ('Grace');`,
        ].join("\n"),
      );
      await snap("review");
      await dialog.getByRole("button", { name: "Exécuter" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("gridcell", { name: "Grace" }).waitFor();

      const after = new Database(targetFile, { readonly: true });
      const rows = after.prepare("SELECT id, name, note FROM customers ORDER BY id").all();
      after.close();
      assert.deepEqual(rows, [
        { id: 1, name: "Ada L.", note: "first" },
        { id: 2, name: "Linus", note: "" },
        { id: 3, name: "Grace", note: null },
      ]);
    } finally {
      await env.teardown();
      rmSync(targetDir, { recursive: true, force: true });
    }
  },
);
