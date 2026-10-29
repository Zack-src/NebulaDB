import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/** Inside a table's `indexes { }` block the editor offers that table's columns. */

const PORT = Number(process.env.E2E_PORT) || 4453;

test("DBML editor: columns are completed inside indexes", { timeout: 90_000 }, async () => {
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
        body: JSON.stringify({
          source: "Table orders {\n  id int [pk]\n  customer_ref int\n  status varchar\n}\nTable other {\n  zzz_col int\n}\n",
        }),
      });
      return id;
    });
    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const last = page.locator(".cm-content .cm-line").filter({ hasText: "status varchar" });
    await last.waitFor();
    await last.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("indexes {", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("cust", { delay: 40 });

    const tooltip = page.locator(".cm-tooltip-autocomplete");
    await tooltip.waitFor();
    const options = await tooltip.locator("li").allInnerTexts();
    assert.ok(options.some((o) => o.includes("customer_ref")), `offered: ${options.join(" | ")}`);
    assert.ok(!options.some((o) => o.includes("zzz_col")), "only this table's columns");
    await page.keyboard.press("Enter");
    const text = await page.locator(".cm-content").innerText();
    assert.match(text, /customer_ref/);
  } finally {
    await env.teardown();
  }
});
