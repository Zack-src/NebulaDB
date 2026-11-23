import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Zones and table groups on the canvas: both are renamed in place like a table (no input box), a group
 * drawn inside a zone can still be clicked and renamed, and removing a group is undone by Ctrl+Z.
 */

const PORT = Number(process.env.E2E_PORT) || 4535;

/** Two tables in a group, all inside a zone (placed by the DBML's visual sidecar). */
const SCHEMA = `Table users {
  id int [pk]
}

Table orders {
  id int [pk]
  user_id int
}

TableGroup billing {
  users
  orders
}

// nebuladb:visual {"tables":{"users":{"position":{"x":200,"y":200}},"orders":{"position":{"x":560,"y":200}}},"zones":[{"id":"z1","label":"Zone A","position":{"x":0,"y":0},"size":{"width":1200,"height":800}}]}
`;

async function openNewProject(page: Page): Promise<void> {
  const inputCountBefore = await page.locator("input").count();
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 });
  await page.locator("input").last().press("Escape");
  const card = page.getByText("Nouveau schéma 1", { exact: true });
  await card.waitFor({ timeout: 10_000 });
  await card.click();
  await page.locator(".svelte-flow__pane").waitFor({ timeout: 10_000 });
}

test(
  "zones and groups: renamed in place, a group inside a zone is clickable, removing a group is undone",
  {
    timeout: 90_000,
  },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await login(page, env.baseUrl);
      await openNewProject(page);
      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(SCHEMA);
      const zone = page.locator(".svelte-flow__node-zone");
      const group = page.locator(".svelte-flow__node-tablegroup");
      await zone.waitFor({ timeout: 10_000 });
      await group.waitFor({ timeout: 10_000 });
      await page.locator('[data-sync-state="synced"]').waitFor({ timeout: 10_000 });

      // The group's label sits inside the zone: what is under the pointer there is the group, not the zone.
      const label = group.getByText(/^billing · 2$/);
      const box = (await label.boundingBox())!;
      const onTop = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".svelte-flow__node-tablegroup")),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      assert.ok(onTop, "the group's label is above the zone");

      // Renamed in place: the same inline field as a table's name.
      await label.dblclick();
      const groupInput = group.locator(".inline-name-input");
      await groupInput.waitFor({ timeout: 5_000 });
      await groupInput.fill("payments");
      await groupInput.press("Enter");
      await group.getByText(/^payments · 2$/).waitFor({ timeout: 5_000 });

      await zone.getByText("Zone A", { exact: true }).dblclick();
      const zoneInput = zone.locator(".inline-name-input");
      await zoneInput.waitFor({ timeout: 5_000 });
      assert.equal(await zone.locator("input").count(), 1, "one inline field, no boxed input");
      if (process.env.E2E_SHOTS) {
        await page.screenshot({
          path: `${process.env.E2E_SHOTS}/zone-rename.png`,
          clip: { x: (await zone.boundingBox())!.x, y: (await zone.boundingBox())!.y, width: 420, height: 300 },
        });
      }
      await zoneInput.fill("Facturation");
      await zoneInput.press("Enter");
      await zone.getByText("Facturation", { exact: true }).waitFor({ timeout: 5_000 });

      // Clicking the zone's own area, away from the group (top right: the minimap covers the bottom), still reaches the zone.
      const zoneBox = (await zone.boundingBox())!;
      const zoneOnTop = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".svelte-flow__node-zone")),
        { x: zoneBox.x + zoneBox.width - 40, y: zoneBox.y + 60 },
      );
      assert.ok(zoneOnTop, "the zone is still reachable outside the group");

      // Removing the group, then Ctrl+Z: it comes back, with its name.
      // An undo step gathers the edits of ~0.5 s (`Y.UndoManager`'s capture): at a person's pace, removing the
      // group is a step of its own, which Ctrl+Z takes back without undoing the renames before it.
      await page.waitForTimeout(800);
      await group.getByRole("button", { name: /Dégrouper/ }).click();
      await group.waitFor({ state: "detached", timeout: 5_000 });
      await page.mouse.click(zoneBox.x + zoneBox.width - 40, zoneBox.y + 60);
      await page.keyboard.press("ControlOrMeta+z");
      await group.getByText(/^payments · 2$/).waitFor({ timeout: 5_000 });
    } finally {
      await env.teardown();
    }
  },
);
