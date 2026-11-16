import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Starting over: the panel's "Repartir de zéro…" drops every table of the database. The
 * dialog counts what goes and asks for the word SUPPRIMER; nothing is recreated.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4415;

test(
  "clean deployment: counted, confirmed by typing the word, every table is dropped",
  { timeout: 90_000 },
  async () => {
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-clean-")), "shop.sqlite");
    const target = new Database(targetFile);
    // Data, and a shape the schema no longer has.
    target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, old_name TEXT);
    INSERT INTO customers (old_name) VALUES ('Ada'), ('Linus'), ('Grace');
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
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `clean-${++shot}-${name}.png`) });
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
            body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  full_name text\n}\n" }),
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

      await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
      const panel = page.getByTestId("deployment-panel");
      await panel.getByRole("button", { name: "Repartir de zéro…" }).click();

      const dialog = page.getByRole("dialog", { name: /Repartir de zéro/ });
      await dialog.getByTestId("clean-drop").getByText("customers").waitFor();
      await dialog.getByText("3 ligne(s)").waitFor();
      await snap("dialog");

      // The action waits for the name.
      const action = dialog.getByRole("button", { name: "Tout supprimer" });
      assert.equal(await action.isDisabled(), true);
      await dialog.getByLabel("SUPPRIMER", { exact: true }).fill("SUPPRIMER");
      assert.equal(await action.isDisabled(), false);
      await action.click();
      await dialog.waitFor({ state: "detached" });

      const after = new Database(targetFile, { readonly: true });
      const tables = after
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      assert.deepEqual(tables, [], "every table is dropped, with its data, and nothing is recreated");
      after.close();
      await snap("done");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
