import assert from "node:assert/strict";
import { test } from "node:test";
import { startE2eEnvironment } from "./harness.js";

/**
 * Closes one of the two remaining browser-test-coverage gaps
 * `docs/todo.md`'s Phase 11/16/23 item flagged: every `components/ui/`
 * primitive, rendered for real. `components/dev/ComponentCatalogue.svelte`
 * already puts one of every variant on a single screen for exactly this
 * kind of check (see that file's own header comment) — no auth, no project,
 * routed straight off `#components` in `Root.svelte` — so this is the cheapest
 * possible smoke test in the whole E2E suite: one page load, no server
 * round-trip beyond serving the static bundle.
 *
 * What this proves that nothing else does: the actual bundle mounts without
 * throwing, in both shipped themes, and every primitive it renders is
 * reachable via role/text queries the way a real user (or a screen reader)
 * would find them — not just that the component compiles.
 */

const PORT = Number(process.env.E2E_PORT) || 4392;
/** Its own port: test files run in parallel, and every port near 4392 belongs to another file. */
const FORMS_PORT = PORT + 12;

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

/**
 * The form components of Phase 29 (`Select`, `Menu`, `Switch`, …) replace
 * native controls, so what the browser used to guarantee — reachable by role,
 * operable from the keyboard — is now this code's job. Each block below drives
 * one component the way a keyboard or screen-reader user would.
 */
test("form components are reachable by role and operable from the keyboard", { timeout: 45_000 }, async () => {
  const env = await startE2eEnvironment(FORMS_PORT);
  try {
    const page = await env.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`${env.baseUrl}/#components`);
    await page.getByText("Catalogue de composants", { exact: true }).waitFor({ timeout: 10_000 });

    // Select: opens on ArrowDown, skips the disabled option, picks on Enter.
    const engine = page.getByRole("combobox", { name: "Moteur", exact: true });
    await engine.focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("listbox", { name: "Moteur", exact: true }).waitFor();
    assert.equal(await page.getByRole("option", { name: "PostgreSQL" }).getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowDown"); // MySQL
    await page.keyboard.press("ArrowDown"); // SQL Server
    await page.keyboard.press("ArrowDown"); // Oracle is disabled → SQLite
    await page.keyboard.press("Enter");
    assert.match(await engine.innerText(), /SQLite/);
    assert.equal(await page.getByRole("listbox").count(), 0, "picking closes the list");
    // …and a letter jumps to the matching option without opening it.
    await page.keyboard.press("m");
    assert.match(await engine.innerText(), /MySQL/);

    // Select with a search field (more than 8 options): type to filter, Enter picks, focus returns to the trigger.
    const type = page.getByRole("combobox", { name: "Type de colonne", exact: true });
    await type.click();
    await page.keyboard.type("JSONB");
    assert.equal(await page.getByRole("option").count(), 1);
    await page.keyboard.press("Enter");
    assert.match(await type.innerText(), /jsonb/);
    assert.equal(await type.evaluate((element) => element === document.activeElement), true);
    // Escape closes without changing the value.
    await type.click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("listbox").count(), 0);
    assert.match(await type.innerText(), /jsonb/);

    // Menu: Enter opens on the first entry, arrows move, the disabled entry is skipped, Escape restores focus.
    const actions = page.getByRole("button", { name: "Actions", exact: true });
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu", { name: "Actions" }).waitFor();
    assert.equal(
      await page.getByRole("menuitem", { name: /Renommer/ }).evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.getByRole("menuitem", { name: /Supprimer/ }).evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu").count(), 0);
    assert.equal(await actions.evaluate((element) => element === document.activeElement), true);
    await actions.click();
    await page.getByRole("menuitem", { name: /Copier/ }).click();
    await page.getByText("Valeur : copy", { exact: true }).waitFor();

    // Checkbox: the label toggles the real (hidden) input.
    const alerts = page.getByRole("checkbox", { name: /Recevoir les alertes/ });
    assert.equal(await alerts.isChecked(), true);
    await page.getByText("Recevoir les alertes par e-mail", { exact: true }).click();
    assert.equal(await alerts.isChecked(), false);

    // Switch and SegmentedControl.
    const snap = page.getByRole("switch", { name: "Aimanter à la grille", exact: true });
    await snap.focus();
    await page.keyboard.press("Space");
    assert.equal(await snap.getAttribute("aria-checked"), "false");
    const density = page.getByRole("radiogroup", { name: "Densité" });
    await density.getByRole("radio", { name: "Confortable" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await density.getByRole("radio", { name: "Compacte" }).getAttribute("aria-checked"), "true");
    await page.keyboard.press("ArrowRight"); // "Dense" is disabled → wraps
    assert.equal(await density.getByRole("radio", { name: "Confortable" }).getAttribute("aria-checked"), "true");

    // NumberInput: bounds apply when the field is left, not while typing.
    const delay = page.getByRole("spinbutton", { name: "Délai maximal" });
    await delay.fill("99");
    assert.equal(await delay.inputValue(), "99");
    await delay.blur();
    assert.equal(await delay.inputValue(), "60");

    // Toast with an action.
    await page.getByRole("button", { name: "Toast avec action" }).click();
    const toastRegion = page.getByRole("region", { name: "Notifications" });
    await toastRegion.getByText("Table « orders » supprimée.").waitFor();
    await toastRegion.getByRole("button", { name: "Annuler" }).click();
    await toastRegion.getByText("Suppression annulée.").waitFor();

    // ConfirmDialog: the destructive button stays disabled until the name is retyped.
    await page.getByRole("button", { name: "Suppression (retaper le nom)" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Supprimer", exact: true });
    assert.equal(await confirm.isDisabled(), true);
    await page.keyboard.type("orders"); // the field took the focus on open
    assert.equal(await confirm.isDisabled(), false);
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "detached" });

    assert.deepEqual(errors, [], `expected no page errors, got:\n${errors.join("\n")}`);
  } finally {
    await env.teardown();
  }
});
