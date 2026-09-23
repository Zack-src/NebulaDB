import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Editor "Compare" → pick another project → name-matched differences and the
 * migration SQL between them. Two projects that share table names but have
 * different ids is exactly the case an id-based diff gets wrong (every table
 * "removed + added"), so that's what this seeds.
 */

const PORT = Number(process.env.E2E_PORT) || 4398;

const PROJECT_B_DBML = `Table users {
  id integer [pk, increment]
  username varchar(50) [not null, unique]
  email varchar(255) [not null, unique]
  created_at timestamp [not null, default: \`now()\`]
  bio text
}
`;

test("compare two projects: name-matched diff, direction, and migration SQL", { timeout: 60_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage();
    page.setDefaultTimeout(15_000);
    await login(page, env.baseUrl);

    // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
    // `__name(...)` call that doesn't exist in the page.
    const projectBId = await page.evaluate(async (dbml) => {
      const json = { "content-type": "application/json" };
      await fetch("/api/projects", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ name: "Blog A", template: "blog" }),
      });
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ name: "Blog B" }),
      });
      const { id } = (await created.json()) as { id: string };
      const imported = await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ source: dbml }),
      });
      if (!imported.ok) throw new Error(`import failed: ${imported.status}`);
      return id;
    }, PROJECT_B_DBML);

    await page.goto(`${env.baseUrl}/project/${projectBId}`);
    await page.locator(".svelte-flow__node").getByText("users", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Comparer" }).click();
    await page.getByTestId("compare-picker").selectOption({ label: "Blog A" });

    // Default direction: the other project (A) is migrated towards the open one (B).
    const counts = page.getByTestId("compare-counts");
    await counts.waitFor();
    assert.match(await counts.innerText(), /0 ajoutée\(s\), 4 supprimée\(s\), 1 modifiée\(s\)/);
    const diffText = await page.getByTestId("compare-diff").innerText();
    assert.match(diffText, /~ Table users/);
    assert.match(diffText, /\+ bio/);
    assert.doesNotMatch(diffText, /\+ Table users/, "same-named tables must be matched, not re-added");

    await page.getByRole("tab", { name: "SQL de migration" }).click();
    const sql = await page.getByTestId("compare-sql").inputValue();
    assert.match(sql, /ALTER TABLE "users" ADD COLUMN "bio" text/);
    assert.match(sql, /DROP TABLE IF EXISTS "posts"/);

    // Swapping the direction turns drops into additions.
    await page.getByRole("tab", { name: "Différences" }).click();
    await page.getByRole("button", { name: "Inverser le sens" }).click();
    assert.match(await counts.innerText(), /4 ajoutée\(s\), 0 supprimée\(s\), 1 modifiée\(s\)/);
  } finally {
    await env.teardown();
  }
});
