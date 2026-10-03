import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin → Activité: what was done through Athanor, filtered by type and
 * project, one entry opened to its detail and its project, the export link
 * carrying the same filters.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4414;

test("activity: filtered list, detail, link to the project, export", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `activity-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(async () => {
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
        body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n}\n" }),
      });
      const snapshot = (await (await fetch(`/api/projects/${id}/snapshot`)).json()) as { tables: { id: string }[] };
      await fetch(`/api/projects/${id}/locks/${snapshot.tables[0].id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ level: "structure", reason: "frozen for the audit" }),
      });
      await fetch("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ name: "Blog" }) });
      return id;
    });

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Activité" }).click();
    const list = page.getByRole("list", { name: "Activité" });
    const entries = list.getByTestId("activity-entry");
    await list.getByText("table.lock").waitFor();
    await list.getByText("project.create").first().waitFor();
    await snap("all");

    // Type: structure — the import and the lock, not the project creations.
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Structure" }).click();
    await list.getByText("project.create").first().waitFor({ state: "detached" });
    assert.deepEqual(
      (await entries.locator("span.font-mono").allInnerTexts()).map((a) => a.trim()).sort(),
      ["project.import", "table.lock"],
    );

    // Back to all types, narrowed to one project.
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Tous les types" }).click();
    await page.getByRole("combobox", { name: "Projet" }).click();
    await page.getByRole("option", { name: "Boutique" }).click();
    await list.getByText("project.import").waitFor();
    const actions = await entries.locator("span.font-mono").allInnerTexts();
    assert.ok(
      actions.every((action) => ["project.create", "project.import", "table.lock"].includes(action.trim())),
      actions.join(", "),
    );

    // The export carries the filters.
    const csvHref = await page.getByRole("link", { name: "Exporter en CSV" }).getAttribute("href");
    assert.match(csvHref ?? "", new RegExp(`projectId=${projectId}`));
    assert.match(csvHref ?? "", /format=csv/);

    // Detail, then the project it is about.
    await entries.filter({ hasText: "table.lock" }).getByRole("button").click();
    await list.locator("dl").getByText("customers (structure, project)").waitFor();
    await snap("detail");
    await list.getByRole("link", { name: "Boutique" }).click();
    await page.waitForURL(`**/project/${projectId}`);

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
