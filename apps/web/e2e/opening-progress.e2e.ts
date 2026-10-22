import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * A big schema opens with its tables lite and gives them their columns back in the background. On a
 * machine slow enough for that to take more than a second and a half, a progress bar says the editor is
 * working; on a fast one it never shows. The columns end up on every table either way.
 */

const PORT = Number(process.env.E2E_PORT) || 4430;
const TABLES = 120;

const SCHEMA = Array.from(
  { length: TABLES },
  (_, i) => `Table t${i} {\n  id int [pk]\n  name varchar\n  parent_id int\n  created_at timestamp\n}\n`,
).join("\n");

test(
  "opening a big schema: tables come lite, the columns follow, a slow machine sees a progress bar",
  { timeout: 120_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const context = await env.browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await login(page, env.baseUrl);
      const projectId = await page.evaluate(async (source) => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Grand" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, { method: "POST", headers: json, body: JSON.stringify({ source }) });
        return id;
      }, SCHEMA);

      // A slow machine: six times less CPU.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      await page.goto(`${env.baseUrl}/project/${projectId}`);
      await page.locator(".svelte-flow__node").first().waitFor();
      // The tables are on the canvas before they have their columns.
      const rowsWhenFirstTableShows = await page.locator(".table-node-row").count();
      assert.ok(rowsWhenFirstTableShows < TABLES, "tables are mounted lite first");

      await page.getByTestId("opening-progress").waitFor();
      assert.equal(await page.getByRole("progressbar").count(), 1);

      // ...and the columns arrive, after which the bar is gone.
      await page.waitForFunction((n) => document.getElementsByClassName("table-node-row").length >= n, TABLES);
      await page.getByTestId("opening-progress").waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
