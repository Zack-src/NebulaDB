import assert from "node:assert/strict";
import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Closes the plugin-sandbox piece of `docs/todo.md`'s Phase 11/16/23
 * browser-test gap. Installs the community "SQLite & Naming Toolkit"
 * template (`communityTemplates.ts`) — real plugin source calling
 * `athanor.plugin(...)`/`athanor.registerExporter(...)` — through the actual
 * Plugin Manager UI, then runs its exporter through the real Export dialog.
 *
 * What this proves that no unit test can: `PluginHost.ts` really does spin
 * up a `Worker`, run untrusted plugin code inside it, and hand a real result
 * back across the `postMessage` boundary — not a mock, not a same-thread
 * `eval`. Deliberately targets this community template rather than the
 * built-in SQLite exporter (`builtins/coreExport.ts`), which runs in the
 * main thread and would prove nothing about the sandbox.
 */

const PORT = Number(process.env.E2E_PORT) || 4393;

test(
  "plugin sandbox: install a community plugin, then its exporter runs for real in the Worker",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      // A wide viewport, not Playwright's small default — at the default
      // size the canvas minimap panel overlaps the plugin toolbar trigger
      // and intercepts the click, same as it would in a real narrow window.
      const page = await env.browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await login(page, env.baseUrl);

      // Open a project and give it one table, so the exporter has something
      // real to emit DDL for.
      const inputCountBefore = await page.locator("input").count();
      await page.getByRole("button", { name: "Nouveau projet" }).first().click();
      await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 });
      await page.locator("input").last().press("Escape");
      const card = page.getByText("Nouveau schéma 1", { exact: true });
      await card.waitFor({ timeout: 10_000 });
      await card.click();
      const canvas = page.locator(".react-flow__pane");
      await canvas.waitFor({ timeout: 10_000 });
      await canvas.click({ button: "right", position: { x: 300, y: 200 } });
      await page.getByText("Ajouter une table", { exact: true }).click();
      await page.locator(".react-flow__node").getByText("table_1", { exact: true }).waitFor({ timeout: 10_000 });

      // Open the Plugin Manager: the canvas toolbar's plugin trigger
      // (icon-only, `data-tooltip` not `aria-label` — see `ToolbarMenu.tsx`)
      // opens a quick palette (`PluginQuickPalette.tsx`) whose footer links
      // to the full manager dialog (`PluginManagerDialog.tsx`, opens on the
      // marketplace tab by default).
      await page.locator('[data-tooltip="Commandes de plugins"]').click();
      await page.getByText("Gestionnaire de plugins…", { exact: true }).click();
      // Every marketplace card is a `div` with the plugin's name *and* an
      // install button as descendants (`MarketplaceTab.tsx`) — filtering by
      // both, rather than guessing which nesting level `hasText` alone would
      // land on, gets the actual card container regardless of DOM depth.
      const pluginCard = page
        .locator("div")
        .filter({ has: page.getByText("SQLite & Naming Toolkit", { exact: true }) })
        .filter({ has: page.getByRole("button", { name: "Installer en 1-clic" }) });
      await pluginCard.getByRole("button", { name: "Installer en 1-clic" }).first().click();

      // `handleInstall` boots the plugin's Worker (`pluginRegistry.install`),
      // waits for its `ready` handshake, then auto-switches to "Mes Plugins"
      // on success — that tab switch is itself proof the sandbox loaded the
      // plugin and registered its contributions without erroring.
      await page.getByRole("button", { name: "Mes Plugins" }).waitFor({ timeout: 15_000 });

      await page.keyboard.press("Escape"); // close the Plugin Manager dialog

      // Open Export and pick the newly-installed plugin's exporter — its
      // option label carries " — <plugin name>" precisely to distinguish it
      // from the built-in, non-sandboxed SQLite exporter with a similar name.
      await page.getByRole("button", { name: "Exporter" }).click();
      const exportSelect = page.locator("select");
      await exportSelect.waitFor({ timeout: 10_000 });
      await exportSelect.selectOption({ label: "SQL — SQLite DDL — SQLite & Naming Toolkit" });

      const textarea = page.locator("textarea[readonly]");
      await textarea.waitFor({ timeout: 10_000 });
      // Runs asynchronously inside the Worker — wait for real output rather
      // than the dialog's own "chargement…" placeholder.
      await page.waitForFunction(
        () => {
          const el = document.querySelector("textarea[readonly]") as HTMLTextAreaElement | null;
          return Boolean(el && /CREATE TABLE/i.test(el.value));
        },
        { timeout: 15_000 },
      );

      const output = await textarea.inputValue();
      assert.match(output, /CREATE TABLE/i);
      assert.match(output, /table_1/i);
    } finally {
      await env.teardown();
    }
  },
);
