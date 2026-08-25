import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The one committed E2E flow `docs/todo.md`'s browser-test-tooling item asked
 * for: create project → edit schema → reload → verify persistence — driven
 * against the actual built app (`apps/server/dist` + `apps/web/dist`) in a
 * real browser, not jsdom. Everything else in this repo's test suites is
 * `node:test` over pure logic or `.inject()` against Fastify directly; this
 * is deliberately the odd one out, and deliberately not folded into `npm
 * test` — see `test:e2e` in `package.json` and CONTRIBUTING.md's "Tests"
 * section for why.
 *
 * What this proves that the REST-level integration tests (`app.test.ts` and
 * siblings) don't: the actual persistence *pipeline* — a real browser tab,
 * the real WebSocket/Yjs sync path, a real page reload re-fetching from
 * SQLite — not just that the right HTTP status comes back.
 *
 * Requires: `npm run build` first (both `apps/server/dist` and
 * `apps/web/dist` must exist), and a Chrome/Chromium/Edge install reachable
 * by `playwright-core`'s channel-based launch (see `harness.ts` — same
 * approach as `scripts/bench-web.mjs`, which already depends on this).
 */

const PORT = Number(process.env.E2E_PORT) || 4390;

test(
  "create project → add a table on the canvas → reload → the table is still there",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      await login(page, env.baseUrl);

      // Creation is instant and Figma-file-browser-style (`ProjectList.tsx`):
      // no name dialog, a placeholder name is assigned, and the new tile opens
      // straight into rename mode rather than navigating anywhere — opening it
      // is a separate click, and while renaming the name is an `<input>`
      // value, not text (`ProjectCard.tsx`), so it has to be waited for
      // separately from the click target. `Escape` cancels the rename and
      // keeps the placeholder name.
      // The list screen's own search field is an `<input>` too and is already
      // on the page, so the rename field is specifically the *last* one, not
      // the first — and calling `.press()` on that Locator (rather than
      // `page.keyboard.press`) focuses it first, so this doesn't race whatever
      // the browser's actual focus happens to be.
      const inputCountBefore = await page.locator("input").count();
      await page.getByRole("button", { name: "Nouveau projet" }).first().click();
      const projectName = "Nouveau schéma 1";
      await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 }); // the new rename field
      await page.locator("input").last().press("Escape");
      const card = page.getByText(projectName, { exact: true });
      await card.waitFor({ timeout: 10_000 });
      await card.click();

      // Right-click empty canvas -> "Ajouter une table" (see CanvasContextMenu.tsx).
      const canvas = page.locator(".react-flow__pane");
      await canvas.waitFor({ timeout: 10_000 });
      await canvas.click({ button: "right", position: { x: 300, y: 200 } });
      await page.getByText("Ajouter une table", { exact: true }).click();

      // `useProjectMutations.ts` names the first table `table_1` deterministically.
      // Scoped to the canvas node specifically — the same text also legitimately
      // appears in the DBML panel once it resyncs, which would otherwise make
      // this locator ambiguous.
      const tableOnCanvas = () => page.locator(".react-flow__node").getByText("table_1", { exact: true });
      await tableOnCanvas().waitFor({ timeout: 10_000 });

      await page.reload();

      // The real assertion: after a full page reload (fresh doc fetch from
      // SQLite, not just an in-memory React state that survived), the table
      // that only existed as an unflushed-to-disk Yjs update moments ago is
      // still there.
      await tableOnCanvas().waitFor({ timeout: 10_000 });
    } finally {
      await env.teardown();
    }
  },
);
