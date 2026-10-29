import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Initial data longer than its column allows is a warning on that column in the DBML editor — and goes away
 * when the column is made long enough.
 * Set `E2E_SHOTS=<dir>` to keep a screenshot.
 */

const PORT = Number(process.env.E2E_PORT) || 4455;

test("DBML editor: a seed value longer than its varchar is a warning on the column", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    await login(page, env.baseUrl);
    const projectId = await page.evaluate(async () => {
      const json = { "content-type": "application/json" };
      const created = await fetch("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ name: "Boutique" }) });
      const { id } = (await created.json()) as { id: string };
      await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n  code varchar(5)\n}\n" }),
      });
      const project = (await (await fetch(`/api/projects/${id}/snapshot`)).json()) as {
        tables: { id: string; fields: { id: string }[] }[];
      };
      const table = project.tables[0];
      const put = await fetch(`/api/projects/${id}/seeds/${table.id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          content: "id,code\n1,abc\n2,much-too-long",
          options: { separator: ",", header: true, mapping: table.fields.map((f) => f.id), mode: "if-empty" },
        }),
      });
      if (!put.ok) throw new Error(`seed failed: ${put.status} ${await put.text()}`);
      return id;
    });

    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const warning = page.locator(".cm-lintRange-warning");
    await warning.first().waitFor();
    await warning.first().hover();
    const tooltip = page.locator(".cm-tooltip-lint");
    await tooltip.waitFor();
    const text = await tooltip.innerText();
    assert.match(text, /code/);
    assert.match(text, /5/);
    assert.match(text, /13/);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "seed-overflow.png") });

    // Widened to fit: the warning goes away once the seeds are checked again.
    await page.locator(".cm-content .cm-line").filter({ hasText: "varchar(5)" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("20)");
    await page.locator(".cm-lintRange-warning").first().waitFor({ state: "detached", timeout: 10_000 });
  } finally {
    await env.teardown();
  }
});
