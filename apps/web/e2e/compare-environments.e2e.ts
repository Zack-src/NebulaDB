import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Two of a project's databases compared from the deployments tab: what each
 * has alone, what differs in a shared table, and what no schema models.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4420;

const SOURCE = `Table customers {
  id integer [pk]
  email varchar(320)
}

Table orders {
  id integer [pk]
}
`;

test("compare environments: differences listed table by table, then none once level", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "athanordb-e2e-compare-"));
  const database = (name: string, ddl: string) => {
    const file = join(dir, `${name}.sqlite`);
    const handle = new Database(file);
    handle.exec(ddl);
    handle.close();
    return file;
  };
  const level =
    "CREATE TABLE customers (id INTEGER PRIMARY KEY, email VARCHAR(320)); CREATE TABLE orders (id INTEGER PRIMARY KEY);";
  const preprod = database("preprod", level);
  const prod = database(
    "prod",
    "CREATE TABLE customers (id INTEGER PRIMARY KEY, email VARCHAR(255), fax TEXT); CREATE TABLE old_export (id INTEGER);",
  );

  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `compare-env-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(
      async ({ preprod, prod, source }) => {
        // No local helper function here: the transpiler's name helper does not exist in the page.
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Boutique" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, { method: "POST", headers: json, body: JSON.stringify({ source }) });
        for (const [name, filePath] of [
          ["PreProd", preprod],
          ["Prod", prod],
        ]) {
          await fetch(`/api/projects/${id}/connections`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name, engine: "sqlite", filePath }),
          });
        }
        return id;
      },
      { preprod, prod, source: SOURCE },
    );

    await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
    const card = page.getByTestId("compare-environments");
    // Both sides are preselected (the current connection and the project's other database); pick them explicitly.
    await card.getByRole("combobox", { name: "Première base" }).click();
    await page.getByRole("option", { name: /^Prod/ }).click();
    await card.getByRole("combobox", { name: "Seconde base" }).click();
    await page.getByRole("option", { name: /^PreProd/ }).click();
    await card.getByRole("button", { name: "Comparer" }).click();

    const row = (name: string) => card.locator(`[data-table="${name}"]`);
    await row("customers").waitFor();
    assert.equal(await row("customers").getAttribute("data-status"), "different");
    // Source is Prod here: its extra column and its shorter e-mail are named.
    await row("customers").getByText("Colonnes seulement dans Prod :").waitFor();
    await row("customers").getByText("fax", { exact: true }).waitFor();
    await row("customers").getByText("varchar(255)").waitFor();
    await row("orders").getByText("Seulement dans PreProd").waitFor();
    await row("old_export").getByText("Seulement dans Prod").waitFor();
    await row("old_export").getByText("Hors schéma").waitFor();
    assert.equal(await row("orders").getByText("Hors schéma").count(), 0);
    await snap("differences");

    // Production brought level by another tool: nothing left to list.
    const handle = new Database(prod);
    handle.exec(`DROP TABLE customers; DROP TABLE old_export; ${level}`);
    handle.close();
    await card.getByRole("button", { name: "Comparer" }).click();
    await card.getByText("« Prod » et « PreProd » ont la même structure.").waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
