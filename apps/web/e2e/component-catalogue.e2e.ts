import assert from "node:assert/strict";
import { join } from "node:path";
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
const GRID_PORT = PORT + 37;
/** The smallest and largest `montant` of the catalogue's generated rows (`ComponentCatalogue.svelte`). */
const GRID_MIN_AMOUNT = "0.14";
const GRID_MAX_AMOUNT = "1429.43";

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

/**
 * `DataGrid` shows query results, where 10 000 rows is an ordinary answer: the
 * catalogue gives it that many, and this checks what a plain `<table>` gave for
 * free and a virtualised grid has to earn — rows far down are reachable, the
 * DOM stays small, and sort and resize work from the mouse and the keyboard.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of the grid in both themes.
 */
test("DataGrid sorts, resizes and scrolls 10 000 rows with a small DOM", { timeout: 45_000 }, async () => {
  const env = await startE2eEnvironment(GRID_PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`${env.baseUrl}/#components`);
    await page.getByText("Catalogue de composants", { exact: true }).waitFor({ timeout: 10_000 });

    const grid = page.getByRole("grid", { name: "Commandes" });
    await grid.scrollIntoViewIfNeeded();
    assert.equal(await grid.getAttribute("aria-rowcount"), "10001", "the header row counts");
    assert.equal(await grid.getAttribute("aria-colcount"), "20");
    /** The row at a position on screen — `aria-rowindex`, where the header is 1. */
    const rowAt = (rowIndex: number) => grid.locator(`[role="row"][aria-rowindex="${rowIndex}"]`);
    const cellsAt = (rowIndex: number) => rowAt(rowIndex).getByRole("gridcell").allInnerTexts();
    const header = (name: string) => grid.getByRole("columnheader", { name, exact: true });
    const sortBy = (name: string) => header(name).getByRole("button").click();
    const dataRows = grid.locator('[role="rowgroup"] > [role="row"]');

    // Virtualised: 10 000 rows given, a few dozen rendered.
    assert.equal((await cellsAt(2))[0], "1");
    const rendered = await dataRows.count();
    assert.ok(rendered > 5 && rendered < 60, `expected a few dozen rows in the DOM, got ${rendered}`);
    // NULL is written as such, and set apart from text.
    assert.equal((await cellsAt(4))[6], "NULL");
    assert.equal(await rowAt(4).getByRole("gridcell").nth(6).locator("span").count(), 1);
    // A value longer than its column is cut on screen and whole in the tooltip.
    const note = rowAt(2).getByRole("gridcell").nth(8);
    assert.match((await note.getAttribute("title")) ?? "", /laisser au gardien si absent\.$/);
    assert.equal(await note.evaluate((cell) => cell.scrollWidth > cell.clientWidth), true);

    // Sort by click: ascending, descending, none.
    assert.equal(await header("id").getAttribute("aria-sort"), "none");
    await sortBy("id");
    assert.equal(await header("id").getAttribute("aria-sort"), "ascending");
    assert.equal((await cellsAt(2))[0], "1");
    await sortBy("id");
    assert.equal(await header("id").getAttribute("aria-sort"), "descending");
    assert.equal((await cellsAt(2))[0], "10000");
    await sortBy("id");
    assert.equal(await header("id").getAttribute("aria-sort"), "none");
    assert.equal((await cellsAt(2))[0], "1");

    // Numbers kept as text sort by value, not as text ("1000.00" would come before "2.00")…
    await sortBy("montant");
    assert.equal((await cellsAt(2))[4], GRID_MIN_AMOUNT);
    assert.equal(await header("id").getAttribute("aria-sort"), "none", "one sorted column at a time");
    await sortBy("montant");
    assert.equal((await cellsAt(2))[4], GRID_MAX_AMOUNT);
    // …and NULL is last in both directions; End, on the grid, goes to the last row.
    await sortBy("remise");
    assert.equal((await cellsAt(2))[6], "0");
    await sortBy("remise");
    assert.equal((await cellsAt(2))[6], "40");
    await grid.focus();
    await page.keyboard.press("End");
    await rowAt(10_001).waitFor();
    assert.equal((await cellsAt(10_001))[6], "NULL");
    await page.keyboard.press("Home");
    await rowAt(2).waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await grid.evaluate((element) => element.scrollTop), 28, "one row per arrow press");
    await sortBy("remise"); // back to unsorted

    // Scroll far down: those rows render, and the DOM is no bigger for it.
    await grid.evaluate((element) => (element.scrollTop = 28 * 5000));
    await rowAt(5002).waitFor();
    assert.equal((await cellsAt(5002))[0], "5001");
    const renderedFarDown = await dataRows.count();
    assert.ok(renderedFarDown < 60, `expected a few dozen rows in the DOM, got ${renderedFarDown}`);
    assert.equal(await rowAt(2).count(), 0, "rows out of view are removed");
    // The header stays on top of the rows.
    const gridBox = await grid.boundingBox();
    const headerBox = await header("id").boundingBox();
    assert.ok(gridBox && headerBox && Math.abs(headerBox.y - gridBox.y) < 2, "sticky header");
    console.log(`DataGrid: ${rendered} rows in the DOM at the top, ${renderedFarDown} at row 5 000, of 10 000`);

    // Resize from the keyboard, on the handle.
    const handle = grid.getByRole("separator", { name: "Redimensionner la colonne client" });
    const width = async () => Math.round((await header("client").boundingBox())?.width ?? 0);
    const initial = await width();
    assert.equal(await handle.getAttribute("aria-valuenow"), String(initial));
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await width(), initial + 16);
    assert.equal(await handle.getAttribute("aria-valuenow"), String(initial + 16));
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await width(), initial - 48);
    await page.keyboard.press("Home");
    assert.equal(await width(), 48, "the minimum width");
    // The cells follow their header.
    const cell = dataRows.first().getByRole("gridcell").nth(1);
    assert.equal(Math.round((await cell.boundingBox())?.width ?? 0), 48);
    await page.keyboard.press("Enter");
    assert.equal(await width(), initial, "Enter fits the content again");
    // The caller is told: the catalogue prints the widths it was handed.
    await page.getByText(new RegExp(`· [0-9]+ / ${initial} / `)).waitFor();

    // …and with the pointer: drag the edge, double-click to fit.
    const box = await handle.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    assert.equal(await width(), initial + 60);
    await handle.dblclick();
    assert.equal(await width(), initial);
    assert.equal(await header("client").getAttribute("aria-sort"), "none", "resizing is not a click on the header");

    // No rows: the header, and a sentence.
    await page.getByRole("grid", { name: "Résultat vide" }).waitFor();
    await page.getByText("Aucune ligne.", { exact: true }).waitFor();

    if (process.env.E2E_SHOTS) {
      await grid.evaluate((element) => (element.scrollTop = 0));
      await sortBy("montant");
      await rowAt(2).waitFor();
      const section = page.locator("section").filter({ has: grid });
      await section.screenshot({ path: join(process.env.E2E_SHOTS, "datagrid-dark.png") });
      await page.getByRole("button", { name: "Clair" }).click();
      await section.screenshot({ path: join(process.env.E2E_SHOTS, "datagrid-light.png") });
    }

    assert.deepEqual(errors, [], `expected no page errors, got:\n${errors.join("\n")}`);
  } finally {
    await env.teardown();
  }
});
