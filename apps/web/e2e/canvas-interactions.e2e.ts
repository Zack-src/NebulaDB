import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Closes the canvas piece of `docs/todo.md`'s Phase 11/16/23 browser-test
 * gap: selection, keyboard delete, undo, and multi-select — the React Flow
 * interactions `project-lifecycle.e2e.ts` doesn't touch (that file only
 * proves add-a-table survives a reload). Each of these lives in its own
 * hook/listener rather than React Flow's own defaults (`useCanvasDeleteKey.ts`
 * for delete, `deleteKeyCode={null}` turns React Flow's own off — see that
 * file's comment), so a unit test over the hook in isolation wouldn't prove
 * the real keyboard→canvas wiring the way driving an actual browser does.
 */

const PORT = Number(process.env.E2E_PORT) || 4391;

/** Opens a fresh project and returns once its (empty) canvas pane is ready. */
async function openNewProject(page: Page): Promise<void> {
  const inputCountBefore = await page.locator("input").count();
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 });
  await page.locator("input").last().press("Escape");
  const card = page.getByText("Nouveau schéma 1", { exact: true });
  await card.waitFor({ timeout: 10_000 });
  await card.click();
  await page.locator(".react-flow__pane").waitFor({ timeout: 10_000 });
}

/** Right-clicks empty canvas at `position` and adds a table there — same flow `project-lifecycle.e2e.ts` uses. */
async function addTable(page: Page, position: { x: number; y: number }): Promise<void> {
  const canvas = page.locator(".react-flow__pane");
  await canvas.click({ button: "right", position });
  await page.getByText("Ajouter une table", { exact: true }).click();
}

function tableNode(page: Page, name: string) {
  return page.locator(".react-flow__node").filter({ hasText: name });
}

/** The clickable table-name header inside a node — field rows below it `stopPropagation()` their own clicks, so clicking the node's bounding-box center can land on a field instead of selecting the table. */
function tableHeader(page: Page, name: string) {
  return tableNode(page, name).getByText(name, { exact: true });
}

test(
  "canvas: select + delete via keyboard, undo brings it back, multi-select surfaces the group toolbar",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      await login(page, env.baseUrl);
      await openNewProject(page);

      // `useProjectMutations.ts` names tables deterministically in creation order.
      // Yjs's `UndoManager` merges same-origin transactions arriving within
      // its default 500ms `captureTimeout` into a single undo step — a real
      // user's actions naturally space out past that, but Playwright's don't,
      // so each logically distinct action here waits it out first. Otherwise
      // one `undo()` unwinds the whole sequence instead of just the delete.
      await addTable(page, { x: 200, y: 150 });
      await tableNode(page, "table_1").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(600);
      await addTable(page, { x: 550, y: 150 });
      await tableNode(page, "table_2").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(600);

      // --- Select + delete via keyboard ---
      // Click the node header (not a field row) to select the table as a whole.
      await tableHeader(page, "table_1").click();
      await page.keyboard.press("Delete");
      await tableNode(page, "table_1").waitFor({ state: "detached", timeout: 10_000 });
      // Its sibling must be untouched — this proves the delete targeted the
      // selected node specifically, not "clear the canvas".
      await tableNode(page, "table_2").waitFor({ timeout: 5_000 });
      await page.waitForTimeout(600);

      // --- Undo brings it back ---
      await page.getByRole("button", { name: "Annuler (Ctrl+Z)" }).click();
      await tableNode(page, "table_1").waitFor({ timeout: 10_000 });
      // The other table must still be there — a single undo reverted just
      // the delete, not the whole session.
      await tableNode(page, "table_2").waitFor({ timeout: 5_000 });

      // --- Multi-select surfaces the group toolbar ---
      // `SelectionColorToolbar.tsx` only renders once 2+ tables are selected
      // and the caller has write access — its presence *is* the assertion
      // that React Flow's multi-select-click actually took. `CanvasArea.tsx`
      // doesn't override React Flow's default `multiSelectionKeyCode`
      // (`["Meta", "Control"]`) — Shift is the *rubber-band* selection key
      // here (`selectionOnDrag`), not the add-to-selection one.
      await tableHeader(page, "table_1").click();
      await tableHeader(page, "table_2").click({ modifiers: ["Control"] });
      await page.getByRole("button", { name: "Grouper" }).waitFor({ timeout: 10_000 });

      // Deselecting (click empty canvas) makes the group toolbar disappear again.
      await page.locator(".react-flow__pane").click({ position: { x: 50, y: 400 } });
      const groupButtonCount = await page.getByRole("button", { name: "Grouper" }).count();
      assert.equal(groupButtonCount, 0, "the group toolbar must not linger after deselecting");
    } finally {
      await env.teardown();
    }
  },
);
