import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin console → database connections, end to end against a real SQLite
 * target: create a global connection, open its console, browse a table, run
 * SQL (read-only refuses a write, write mode runs it), and drop a table only
 * after its name is typed back. Engine-specific behaviour (accounts,
 * privileges, sessions) is covered server-side in `dbAdmin/drivers/live.test.ts`.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each stage.
 */

const PORT = Number(process.env.E2E_PORT) || 4397;

test("admin: add a connection, explore it, query it and drop a table", { timeout: 90_000 }, async () => {
  const targetDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-target-"));
  const targetFile = join(targetDir, "shop.sqlite");
  const target = new Database(targetFile);
  target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total REAL);
    INSERT INTO customers (name, email) VALUES ('Ada', 'ada@example.com'), ('Linus', NULL);
    INSERT INTO invoices (customer_id, total) VALUES (1, 120.5);
  `);
  target.close();

  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Connexions base de données" }).click();
    await page.getByText("Aucune connexion pour le moment.").waitFor();

    // Create.
    await page.getByRole("button", { name: "Nouvelle connexion" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("ex: Production DB").fill("Boutique");
    await dialog.getByRole("combobox", { name: "Moteur de base de données" }).click();
    await page.getByRole("option", { name: "SQLite" }).click();
    await dialog.getByPlaceholder("./data/app.sqlite").fill(targetFile);
    await dialog.getByPlaceholder("ex. client-a, europe (séparés par des virgules)").fill("demo, local");
    await dialog.getByRole("button", { name: "Tester la connexion" }).click();
    await dialog.getByText(/Connexion établie avec succès/).waitFor();
    await snap("edit-modal");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await page.getByText("Boutique", { exact: true }).waitFor();
    await page.getByText("demo", { exact: true }).waitFor();

    // Health.
    await page.getByRole("button", { name: "Vérifier la connexion" }).click();
    await page.getByRole("img", { name: /^En ligne/ }).waitFor();
    await snap("list");

    // Explorer.
    await page.getByRole("button", { name: "Ouvrir" }).click();
    await page.getByRole("button", { name: /customers/ }).click();
    await page.getByRole("cell", { name: "ada@example.com" }).waitFor();
    await snap("explorer-data");
    await page.getByRole("tab", { name: "Structure" }).click();
    await page.getByRole("cell", { name: "INTEGER" }).first().waitFor();
    await snap("explorer-structure");
    // SQLite has neither accounts nor sessions: those sections are not offered at all.
    assert.equal(await page.getByRole("tab", { name: "Utilisateurs et permissions" }).count(), 0);

    // SQL console.
    await page.getByRole("tab", { name: "Console SQL" }).click();
    const editor = page.getByRole("textbox", { name: "Console SQL" });
    await editor.fill("SELECT name FROM customers ORDER BY id");
    await page.getByRole("button", { name: "Exécuter", exact: true }).click();
    await page.getByRole("cell", { name: "Linus" }).waitFor();

    await editor.fill("DELETE FROM customers");
    await page.getByRole("button", { name: "Exécuter", exact: true }).click();
    await page.getByText(/Mode lecture seule/).waitFor();
    await snap("sql-read-only-refusal");

    await page.getByRole("switch", { name: "Mode écriture" }).click();
    await editor.fill("UPDATE customers SET name = 'Ada Lovelace' WHERE id = 1");
    await page.getByRole("button", { name: "Exécuter", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Exécuter en écriture" }).click();
    await page.getByText("1 ligne(s) affectée(s)").waitFor();
    await snap("sql-write");

    // Drop, with the name typed back.
    await page.getByRole("tab", { name: "Explorateur" }).click();
    await page.getByRole("button", { name: /invoices/ }).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    const confirm = page.getByRole("dialog");
    await confirm.getByText('DROP TABLE "invoices";').waitFor();
    const execute = confirm.getByRole("button", { name: "Exécuter" });
    assert.equal(await execute.isDisabled(), true, "locked until the name is typed");
    await confirm.getByRole("textbox").fill("invoices");
    await snap("drop-confirm");
    await execute.click();
    await confirm.waitFor({ state: "detached" });
    await page.getByRole("button", { name: /customers/ }).waitFor();
    // Waited for, not counted at once: the list is refetched after the drop.
    await page.getByRole("button", { name: /invoices/ }).waitFor({ state: "detached" });

    const after = new Database(targetFile, { readonly: true });
    const tables = (
      after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    ).map((t) => t.name);
    const ada = after.prepare("SELECT name FROM customers WHERE id = 1").get() as { name: string };
    after.close();
    assert.deepEqual(tables, ["customers"]);
    assert.equal(ada.name, "Ada Lovelace");
  } finally {
    await env.teardown();
    rmSync(targetDir, { recursive: true, force: true });
  }
});
