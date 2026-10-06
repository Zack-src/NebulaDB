import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The watch: turned on from the deployments tab, a change made to the
 * database by another tool is found on the next check, listed, and turns on
 * the editor's drift banner.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4415;

test("monitoring: a change made outside Nebula is found and shown", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-monitor-")), "shop.sqlite");
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `monitoring-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    // A project deployed once to its database: there is a reference to compare with.
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
          body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n}\n" }),
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

    await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
    const card = page.getByTestId("monitoring");
    await card.getByText("Jamais vérifiée").waitFor();
    await card.getByRole("switch", { name: "Surveiller les bases" }).click();
    await card.getByRole("button", { name: "Vérifier maintenant" }).click();
    await card.getByText(/Dernière vérification/).waitFor();
    assert.equal(await card.getByRole("list", { name: "Ce que la surveillance a trouvé" }).count(), 0);

    // Another tool changes the database.
    const target = new Database(targetFile);
    target.exec("CREATE TABLE audit_copy (id INTEGER); ALTER TABLE customers ADD COLUMN note TEXT;");
    target.close();

    await card.getByRole("button", { name: "Vérifier maintenant" }).click();
    const found = card.getByRole("list", { name: "Ce que la surveillance a trouvé" }).getByRole("listitem");
    await found.first().waitFor();
    assert.equal(await found.first().getAttribute("data-kind"), "external");
    await found.first().getByText("+audit_copy ~customers").waitFor();
    await snap("found");

    // The editor says so.
    await page.getByRole("tab", { name: "Schéma", exact: true }).click();
    await page.getByText("La base « Base boutique » a été modifiée en dehors du schéma").waitFor();
    await snap("banner");

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
