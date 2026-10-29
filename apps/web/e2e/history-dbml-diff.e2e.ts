import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * History: the DBML of the selected revision against the schema now, side by side. Only the changed
 * lines (added, removed, modified) with a little context by default; both texts in full on request.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each view.
 */

const PORT = Number(process.env.E2E_PORT) || 4443;

// A long table nobody touches comes first: the differences view folds it, the full view shows it.
const OPTIONS = Array.from({ length: 12 }, (_, i) => `  option_${i} varchar`).join("\n");
const SETTINGS = `Table settings {\n${OPTIONS}\n}\n`;
const V1 = `${SETTINGS}Table users {
  id int [pk]
  email varchar
  legacy int
}
`;
const V2 = `${SETTINGS}Table users {
  id bigint [pk]
  email varchar
}
Table orders {
  id int [pk]
}
`;

test(
  "history: the DBML diff shows the changes side by side, or the full code of both sides",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1500, height: 950 } });
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);
      const projectId = await page.evaluate(
        async ({ v1, v2 }) => {
          const json = { "content-type": "application/json" };
          const created = await fetch("/api/projects", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Boutique" }),
          });
          const { id } = (await created.json()) as { id: string };
          const url = `/api/projects/${id}/import`;
          await fetch(url, { method: "POST", headers: json, body: JSON.stringify({ source: v1 }) });
          await new Promise((resolve) => setTimeout(resolve, 700));
          await fetch(url, { method: "POST", headers: json, body: JSON.stringify({ source: v2 }) });
          // Name the first state, so the test can pick it in the timeline.
          const list = (await (await fetch(`/api/projects/${id}/revisions`)).json()) as {
            id: string;
            createdAt: string;
          }[];
          const first = list.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
          await fetch(`/api/projects/${id}/revisions/${first.id}`, {
            method: "PATCH",
            headers: json,
            body: JSON.stringify({ label: "première version" }),
          });
          return id;
        },
        { v1: V1, v2: V2 },
      );

      await page.goto(`${env.baseUrl}/project/${projectId}`);
      await page.getByText("Historique", { exact: true }).first().click();
      const view = page.getByTestId("dbml-diff");
      await view.waitFor();
      const shot = (name: string) =>
        process.env.E2E_SHOTS
          ? page.screenshot({ path: join(process.env.E2E_SHOTS, `history-dbml-${name}.png`) })
          : undefined;

      // New text on the left, old text on the right.
      const headers = await view.locator(".grid-cols-2").first().locator("> div").allInnerTexts();
      assert.match(headers[0], /Après/);
      assert.match(headers[1], /Avant/);

      await page.getByText("première version").first().click();
      await view.locator("[data-kind]").first().waitFor();
      // Differences only: a modified line, a removed one, added ones.
      const kinds = await view
        .locator("[data-kind]")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
      for (const kind of ["changed", "removed", "added"]) assert.ok(kinds.includes(kind), `a ${kind} row is shown`);
      const changedRow = view.locator('[data-kind="changed"]').first();
      assert.match(await changedRow.innerText(), /id\s+bigint/, "the new line is on the left");
      assert.match(await changedRow.innerText(), /id\s+int/, "the old line is on the right");
      assert.match(await view.innerText(), /lignes inchangées/, "the untouched lines are folded");
      const diffOnlyCount = kinds.length;
      await shot("diff");

      // Full code of both sides.
      await page.getByRole("radio", { name: "Code complet" }).click();
      const fullKinds = await view
        .locator("[data-kind]")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
      assert.ok(fullKinds.includes("same"), "unchanged lines are shown too");
      assert.ok(fullKinds.length > diffOnlyCount, "more rows than the differences alone");
      await shot("full");

      await page.getByRole("radio", { name: "Différences" }).click();
      assert.equal(await view.locator("[data-kind]").count(), diffOnlyCount);
    } finally {
      await env.teardown();
    }
  },
);
