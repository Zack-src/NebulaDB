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
  { timeout: 240_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const context = await env.browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
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
        const imported = await fetch(`/api/projects/${id}/import`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ source }),
        });
        if (!imported.ok) throw new Error(`import refused: ${imported.status} ${await imported.text()}`);
        return id;
      }, SCHEMA);

      // A slow machine. A development machine is slowed ten times (the batches got quick enough that six times no
      // longer outlasts the bar's 1.5 s delay); a CI runner already is slow (software rendering: ten times less
      // CPU on top and its first table never shows within two minutes), so it is left as it is.
      if (!process.env.CI) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 10 });
      }
      // The bar stays up a few hundred milliseconds only, and a throttled page answers the test slowly: a
      // watcher in the page records that it showed, and what it said, instead of the test polling for it.
      await page.addInitScript(() => {
        const w = window as unknown as { __openingBar?: { seen: boolean; bars: number } };
        w.__openingBar = { seen: false, bars: 0 };
        new MutationObserver(() => {
          const bar = document.querySelector("[data-testid=opening-progress]");
          if (!bar || !w.__openingBar) return;
          w.__openingBar.seen = true;
          w.__openingBar.bars = Math.max(w.__openingBar.bars, bar.querySelectorAll("[role=progressbar]").length);
        }).observe(document, { childList: true, subtree: true });
      });
      await page.goto(`${env.baseUrl}/project/${projectId}`);
      await page.locator(".svelte-flow__node").first().waitFor();
      // The tables are on the canvas before they have their columns.
      const rowsWhenFirstTableShows = await page.locator(".table-node-row").count();
      assert.ok(rowsWhenFirstTableShows < TABLES, "tables are mounted lite first");

      await page.waitForFunction(() => (window as unknown as { __openingBar?: { seen: boolean } }).__openingBar?.seen);
      assert.equal(
        await page.evaluate(() => (window as unknown as { __openingBar: { bars: number } }).__openingBar.bars),
        1,
      );

      // ...and the columns arrive, after which the bar is gone.
      await page.waitForFunction((n) => document.getElementsByClassName("table-node-row").length >= n, TABLES);
      await page.getByTestId("opening-progress").waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
