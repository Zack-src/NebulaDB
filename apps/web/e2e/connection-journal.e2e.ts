import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin → Connexions → Ouvrir → Journal: one database's journal (the console
 * opened, the statements run, filtered by type, exported with the database
 * as a filter) and its "Requêtes" view — statements counted by shape, values
 * replaced by `?`, timed by Nebula and said so. The accounts watch is
 * covered server-side (`monitoring/accountWatch.test.ts`,
 * `accountReader.live.test.ts`): SQLite, the only engine an e2e run has for
 * sure, has no accounts.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4447;

test(
  "connection journal: events of one database, filters, export, statement figures",
  { timeout: 90_000 },
  async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "nebuladb-e2e-journal-"));
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `journal-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);

      const connectionId = await page.evaluate(
        async (filePath) => {
          const json = { "content-type": "application/json" };
          const made = await fetch("/api/admin/connections", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Boutique", engine: "sqlite", filePath }),
          });
          const { connection } = (await made.json()) as { connection: { id: string } };
          // No helper function in here: the bundler would wrap it in a `__name` call the page does not have.
          const statements: [string, boolean][] = [
            ["CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)", false],
            ["INSERT INTO items (id, label) VALUES (1, 'confidential-a'), (2, 'confidential-b')", false],
            ["SELECT * FROM items WHERE id = 1", true],
            ["SELECT * FROM items WHERE id = 2", true],
            ["SELECT * FROM items WHERE id = 3", true],
          ];
          for (const [sql, readOnly] of statements) {
            await fetch(`/api/admin/connections/${connection.id}/query`, {
              method: "POST",
              headers: json,
              body: JSON.stringify({ sql, readOnly }),
            });
          }
          return connection.id;
        },
        join(targetDir, "shop.sqlite"),
      );

      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("button", { name: "Ouvrir" }).click();
      await page.getByRole("tab", { name: "Journal" }).click();

      const list = page.getByRole("list", { name: "Événements" });
      const entries = list.getByTestId("journal-entry");
      // Opening the console is itself in the journal, next to the statements.
      await entries.filter({ hasText: "dbconn.open" }).first().waitFor();
      assert.equal(await entries.filter({ hasText: "dbadmin.query" }).count(), 5);
      await snap("events");

      // Type: data — the statements only.
      await page.getByRole("combobox", { name: "Type" }).click();
      await page.getByRole("option", { name: "Données" }).click();
      await entries.filter({ hasText: "dbconn.open" }).first().waitFor({ state: "detached" });
      assert.equal(await entries.count(), 5);
      const csvHref = (await page.getByRole("link", { name: "Exporter en CSV" }).getAttribute("href")) ?? "";
      assert.match(csvHref, new RegExp(`connectionId=${connectionId}`));
      assert.match(csvHref, /category=data/);

      // An entry's detail: the statement, its rows and duration, its author.
      await entries.filter({ hasText: "INSERT INTO items" }).getByRole("button").click();
      await list
        .locator("dl")
        .getByText(/WRITE ok 2 row\(s\) \d+ms: INSERT INTO items/)
        .waitFor();

      // The author filter lists who appears in this journal.
      await page.getByRole("combobox", { name: "Auteur" }).click();
      await page.getByRole("option", { name: "Tous les auteurs" }).waitFor();
      assert.equal(await page.getByRole("option").count(), 2);
      await page.keyboard.press("Escape");

      // Statement figures: grouped by shape, values gone, measured by Nebula.
      await page.getByRole("radio", { name: "Requêtes" }).click();
      await page.getByText("Mesuré par Nebula").waitFor();
      const rows = page.getByTestId("query-stat");
      const select = rows.filter({ hasText: "SELECT * FROM items WHERE id = ?" });
      await select.waitFor();
      assert.equal((await select.locator("td").nth(1).innerText()).trim(), "3");
      assert.equal(await rows.filter({ hasText: "confidential" }).count(), 0);
      await rows.filter({ hasText: "INSERT INTO items (id, label) VALUES (?)" }).waitFor();
      await page.getByRole("radio", { name: "Plus lentes" }).click();
      await select.waitFor();
      await snap("queries");

      // --- Santé: SQLite answers, and says what it cannot give instead of showing zeros ---
      await page.getByRole("tab", { name: "Santé" }).click();
      const board = page.getByTestId("health-board");
      await board.getByTestId("health-status").waitFor();
      assert.equal(await board.getByTestId("health-status").getAttribute("data-ok"), "true");
      await board.getByTestId("health-sessions").getByText("Non disponible").waitFor();
      await snap("health");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
      rmSync(targetDir, { recursive: true, force: true });
    }
  },
);
