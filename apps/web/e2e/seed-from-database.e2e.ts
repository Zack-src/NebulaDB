import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * "Export as initial data": from a table in the database console, the rows it
 * holds become the seed of the schema's table — shown checked in the seed
 * dialog first, saved only when the person says so.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4418;

test("seeds: a table's rows in the database become its initial data, after review", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-seed-db-")), "shop.sqlite");
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `seed-db-${++shot}-${name}.png`) });
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
          body: JSON.stringify({
            source: "Table countries {\n  code varchar(2) [pk]\n  label varchar(40) [not null]\n  note text\n}\n",
          }),
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

    // The reference rows were typed into the database, not into Nebula.
    const target = new Database(targetFile);
    target.exec(
      "INSERT INTO countries VALUES ('FR', 'France', NULL), ('BE', 'Belgique', ''), ('CH', 'Suisse', 'hors UE')",
    );
    target.close();

    await page.goto(`${env.baseUrl}/project/${projectId}/data`);
    await page.getByRole("button", { name: /countries/ }).click();
    await page.getByRole("gridcell", { name: "Belgique" }).waitFor();
    await snap("explorer");
    await page.getByRole("button", { name: "Données initiales", exact: true }).click();

    // Back on the schema, the table's dialog holds the database's rows — not saved yet.
    await page.waitForURL(`${env.baseUrl}/project/${projectId}`);
    const dialog = page.getByRole("dialog", { name: "Données initiales — countries" });
    await dialog.getByText("Lignes de « Base boutique »").waitFor();
    await dialog.getByText("3 lignes").waitFor();
    const preview = dialog.getByRole("table", { name: /Aperçu/ });
    await preview.getByRole("cell", { name: "Suisse" }).waitFor();
    await preview.getByRole("cell", { name: "hors UE" }).waitFor();
    await snap("dialog");
    const before = await page.evaluate(async (id) => {
      const res = await fetch(`/api/projects/${id}/seeds`);
      return ((await res.json()) as { seeds: unknown[] }).seeds.length;
    }, projectId);
    assert.equal(before, 0, "nothing is saved before the person says so");

    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await dialog.waitFor({ state: "detached" });
    const saved = await page.evaluate(async (id) => {
      const list = (await (await fetch(`/api/projects/${id}/seeds`)).json()) as {
        seeds: { tableId: string; tableName: string; rowCount: number }[];
      };
      const seed = (await (await fetch(`/api/projects/${id}/seeds/${list.seeds[0].tableId}`)).json()) as {
        seed: { content: string };
      };
      return { summary: list.seeds[0], content: seed.seed.content };
    }, projectId);
    assert.equal(saved.summary.tableName, "countries");
    assert.equal(saved.summary.rowCount, 3);
    // In key order; NULL (nothing) and the empty string (`""`) are still two different things.
    assert.equal(saved.content, 'code,label,note\nBE,Belgique,""\nCH,Suisse,hors UE\nFR,France,\n');

    // The same reading is offered from the dialog itself.
    await page
      .locator(".svelte-flow__node")
      .filter({ hasText: "countries" })
      .getByRole("button", { name: /Données initiales/ })
      .click();
    await page
      .getByRole("dialog", { name: "Données initiales — countries" })
      .getByRole("button", { name: "Reprendre les lignes de la base" })
      .waitFor();
    await snap("button");

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
