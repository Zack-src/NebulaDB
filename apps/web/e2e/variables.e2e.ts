import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Per-environment variables: an administrator gives a stage its values in
 * Admin → Environnements, and a schema whose table name holds a placeholder
 * is deployed to that stage's database under the resolved name.
 */

const PORT = Number(process.env.E2E_PORT) || 4421;

const SOURCE = `Table "{{table_prefix}}orders" {
  id integer [pk]
}
`;

test("variables: typed on a stage, kept, and used by a deployment to that stage", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-vars-")), "dev.sqlite");
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await login(page, env.baseUrl);

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Environnements" }).click();
    const group = page.getByRole("group", { name: "Variables de DEV" });
    await group.waitFor();

    // A name that is not an identifier is flagged before anything is sent.
    await group.getByRole("button", { name: "Ajouter une variable" }).click();
    await group.getByLabel("Nom de variable de DEV").fill("1bad name");
    await group.getByText("Nom invalide").waitFor();
    assert.equal(await group.getByRole("button", { name: "Enregistrer les variables" }).isDisabled(), true);

    // An empty value is a variable like any other.
    await group.getByLabel("Nom de variable de DEV").fill("table_prefix");
    await group.getByLabel("Valeur de table_prefix sur DEV").fill("dev_");
    await group.getByRole("button", { name: "Ajouter une variable" }).click();
    await group.getByLabel("Nom de variable de DEV").nth(1).fill("schema");
    await group.getByRole("button", { name: "Enregistrer les variables" }).click();
    await page.getByRole("group", { name: "Variables de DEV" }).getByLabel("Valeur de schema sur DEV").waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Nom de variable de DEV"]').length === 2);
    await page.reload();
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Environnements" }).click();
    assert.equal(await page.getByLabel("Valeur de table_prefix sur DEV").inputValue(), "dev_");
    assert.equal(await page.getByLabel("Valeur de schema sur DEV").inputValue(), "");

    // A project whose table is named with the placeholder, deployed to a DEV database and to a Staging one.
    const outcome = await page.evaluate(
      async ({ source, filePath }) => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Boutique" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, { method: "POST", headers: json, body: JSON.stringify({ source }) });
        const results: { status: number; code?: string }[] = [];
        for (const [name, environment, file] of [
          ["Dev db", "DEV", filePath],
          ["Staging db", "Staging", `${filePath}.staging`],
        ]) {
          const connection = await fetch(`/api/projects/${id}/connections`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name, engine: "sqlite", filePath: file, environment }),
          });
          const connId = ((await connection.json()) as { connection: { id: string } }).connection.id;
          const deployed = await fetch(`/api/projects/${id}/connections/${connId}/apply-deployment`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ resolutions: {} }),
          });
          results.push({ status: deployed.status, code: ((await deployed.json()) as { code?: string }).code });
        }
        return results;
      },
      { source: SOURCE, filePath: targetFile },
    );
    assert.equal(outcome[0].status, 200);
    // Staging was given no value: refused rather than deployed as `{{table_prefix}}orders`.
    assert.deepEqual(outcome[1], { status: 409, code: "VARIABLES_UNRESOLVED" });

    const target = new Database(targetFile, { readonly: true });
    const tables = (
      target.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    target.close();
    assert.deepEqual(tables, ["dev_orders"]);

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
