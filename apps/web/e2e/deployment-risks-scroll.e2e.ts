import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Answering a long list of risks one by one: the list scrolls inside its own frame, and the page must
 * stay where it is (the radios are hidden inputs; one not contained by its label used to drag the whole
 * page down and leave a blank stretch below).
 */

const PORT = Number(process.env.E2E_PORT) || 4439;

test("deployment risks: choosing an answer in a long list never scrolls the page", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-risks-scroll-")), "shop.sqlite");
  const target = new Database(targetFile);
  target.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);");
  for (let i = 1; i <= 8; i++) {
    target.exec(
      `CREATE TABLE extra_${i} (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO extra_${i} (v) VALUES ('a'), ('b');`,
    );
  }
  target.close();

  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
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

    await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
    const panel = page.getByTestId("deployment-panel");
    await panel.getByText("2 ligne(s) concernée(s)").first().waitFor();
    const groups = panel.getByRole("radiogroup");
    const count = await groups.count();
    assert.equal(count, 8);
    for (let i = 0; i < count; i++) {
      const answer = groups.nth(i).locator("label", { hasText: "Supprimer" }).first();
      await answer.scrollIntoViewIfNeeded();
      await answer.click();
      assert.equal(await page.evaluate(() => window.scrollY), 0, `the page stays put after answer ${i + 1}`);
    }
  } finally {
    await env.teardown();
  }
});
