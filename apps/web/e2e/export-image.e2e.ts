import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Exporting the canvas as an image or a PDF: the dialog shows the snapshot, nothing loops, and the
 * diagram comes out at its own size (two pixels per canvas pixel) wherever the canvas is zoomed or
 * scrolled — names stay readable when the file is zoomed in — without the "+ Ajouter une colonne"
 * footers, the tables no taller than their columns.
 *
 * Earlier, the capture fitted the diagram into the window first (text a few pixels high on a big
 * schema), and rewrote the flow's nodes from the dialog's effect, which re-ran on its own write
 * until Svelte gave up (`effect_update_depth_exceeded`). `E2E_SHOTS=<dir>` saves the PNG to look at.
 */

const PORT = Number(process.env.E2E_PORT) || 4532;

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

test("exporting the canvas as PNG and PDF shows the snapshot, with no update loop", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 800 } });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await login(page, env.baseUrl);
    await openNewProject(page);
    await page.locator(".svelte-flow__pane").click({ button: "right", position: { x: 300, y: 200 } });
    await page.getByText("Ajouter une table", { exact: true }).click();
    await page.locator(".svelte-flow__node").first().waitFor({ timeout: 10_000 });
    // Zoomed far out, as on a big schema: the export must not inherit the screen's scale.
    await page.locator(".svelte-flow__pane").hover({ position: { x: 600, y: 400 } });
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);

    await page.getByRole("button", { name: "Exporter" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 10_000 });
    for (const label of ["Image — PNG", "PDF"]) {
      await dialog.locator("select").selectOption({ label });
      const preview = dialog.getByRole("img", { name: "Aperçu de la capture du canvas" });
      await preview.waitFor({ timeout: 15_000 });
      assert.match((await preview.getAttribute("src")) ?? "", /^data:image\//, `${label}: a snapshot`);
      await dialog.getByText("Rendu du canvas…").waitFor({ state: "detached", timeout: 15_000 });
      // The diagram is rendered at its own size, two pixels per canvas pixel, whatever the window
      // or the zoom: a table's text keeps a readable size in the file.
      // The table as laid out for an export: its real size (it may be off screen) and no footer.
      const table = await page.evaluate(async () => {
        const viewport = document.querySelector(".svelte-flow__viewport")!;
        viewport.classList.add("canvas-exporting");
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const node = document.querySelector(".svelte-flow__node") as HTMLElement;
        const size = { width: node.offsetWidth, height: node.offsetHeight };
        viewport.classList.remove("canvas-exporting");
        return size;
      });
      // No named function inside: tsx would wrap it with a helper the page does not have.
      const image = await preview.evaluate(async (el) => {
        const img = el as HTMLImageElement;
        if (!img.complete) await new Promise((resolve) => img.addEventListener("load", resolve));
        return { width: img.naturalWidth, height: img.naturalHeight };
      });
      if (process.env.E2E_SHOTS && label === "Image — PNG") {
        const src = (await preview.getAttribute("src")) ?? "";
        writeFileSync(`${process.env.E2E_SHOTS}/export-image.png`, Buffer.from(src.split(",")[1] ?? "", "base64"));
      }
      // The "+ Ajouter une colonne" footer is on the canvas, marked to be left out of the file.
      assert.ok(
        await page.locator(".svelte-flow__node [data-export-hidden]", { hasText: "Ajouter une colonne" }).count(),
        "the add-column footer is marked for exports",
      );
      // Two pixels per canvas pixel around the table and its margin — the footer's height excluded.
      for (const side of ["width", "height"] as const) {
        const expected = (table[side] + 2 * 48) * 2;
        assert.ok(
          Math.abs(image[side] - expected) <= 6,
          `${label}: ${side} ${image[side]}px, expected about ${expected}px`,
        );
      }
    }
    assert.deepEqual(
      errors.filter((e) => /effect_update_depth_exceeded|Maximum update depth|render error/.test(e)),
      [],
    );
  } finally {
    await env.teardown();
  }
});
