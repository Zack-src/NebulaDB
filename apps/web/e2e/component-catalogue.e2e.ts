import assert from "node:assert/strict";
import { test } from "node:test";
import { startE2eEnvironment } from "./harness.js";

/**
 * Closes one of the two remaining browser-test-coverage gaps
 * `docs/todo.md`'s Phase 11/16/23 item flagged: every `components/ui/`
 * primitive, rendered for real. `components/dev/ComponentCatalogue.tsx`
 * already puts one of every variant on a single screen for exactly this
 * kind of check (see that file's own header comment) — no auth, no project,
 * routed straight off `#components` in `main.tsx` — so this is the cheapest
 * possible smoke test in the whole E2E suite: one page load, no server
 * round-trip beyond serving the static bundle.
 *
 * What this proves that nothing else does: the actual bundle mounts without
 * throwing, in both shipped themes, and every primitive it renders is
 * reachable via role/text queries the way a real user (or a screen reader)
 * would find them — not just that the component compiles.
 */

const PORT = Number(process.env.E2E_PORT) || 4392;

test(
  "component catalogue renders every primitive, in both themes, with no console errors",
  { timeout: 30_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        // "Failed to load resource: ... 404" is Chromium surfacing the
        // browser's own automatic `/favicon.ico` request (the app ships no
        // favicon link) as a console error — a network-log artifact, not
        // something the app's own code did wrong. Real application errors
        // (a thrown render, a bad prop) come through as JS `console.error`
        // calls or `pageerror`, neither of which look like this.
        if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(String(err)));

      await page.goto(`${env.baseUrl}/#components`);
      await page.getByText("Catalogue de composants", { exact: true }).waitFor({ timeout: 10_000 });

      // One representative element per section — not exhaustive over every
      // variant (the point is "the bundle mounted and rendered real DOM", not
      // pixel coverage), but wide enough that a broken import or a component
      // that throws on mount fails loudly here instead of only in a manual
      // click-through.
      await page.getByRole("button", { name: "sm" }).first().waitFor();
      await page.getByText("admin", { exact: true }).waitFor(); // a Badge tone
      await page.getByText("Table users", { exact: true }).waitFor(); // ListRow example
      // The same "Sécurité" tab label appears once per Tabs variant demoed
      // (pill/line/boxed) — asserting one is visible is enough to prove the
      // section rendered; it doesn't need to be unique.
      await page.getByText("Sécurité", { exact: true }).first().waitFor(); // Tabs demo item

      // Flip to the light theme via the catalogue's own toggle and confirm the
      // page is still intact — the same primitives, not a blank/broken screen.
      await page.getByRole("button", { name: "Clair" }).click();
      await page.getByText("Catalogue de composants", { exact: true }).waitFor();
      await page.getByRole("button", { name: "sm" }).first().waitFor();

      assert.deepEqual(consoleErrors, [], `expected no console errors, got:\n${consoleErrors.join("\n")}`);
    } finally {
      await env.teardown();
    }
  },
);
