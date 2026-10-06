import test from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

test("NebulaDB preserves historical preferences and resumes an old browser session", { timeout: 60_000 }, async () => {
  const env = await startE2eEnvironment(4497);
  try {
    const page = await env.browser.newPage();
    await page.addInitScript(() => {
      if (localStorage.getItem("rename-seeded")) return;
      localStorage.setItem("athanordb.theme", "light");
      localStorage.setItem("athanordb.locale", "fr");
      localStorage.setItem("athanordb.viewport.project.user", '{"x":12,"y":34}');
      localStorage.setItem("rename-seeded", "1");
    });
    await login(page, env.baseUrl);
    assert.equal(await page.title(), "NebulaDB");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    assert.equal(await page.evaluate(() => localStorage.getItem("nebuladb.viewport.project.user")), '{"x":12,"y":34}');
    const context = page.context();
    const cookie = (await context.cookies()).find((entry) => entry.name === "nebuladb_sid")!;
    assert.ok(cookie);
    await context.clearCookies();
    await context.addCookies([{ ...cookie, name: "athanordb_sid" }]);
    await page.reload();
    await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor();
    const renewed = await context.cookies();
    assert.ok(renewed.some((entry) => entry.name === "nebuladb_sid" && entry.value === cookie.value));
    assert.equal(
      renewed.some((entry) => entry.name === "athanordb_sid"),
      false,
    );
  } finally {
    await env.teardown();
  }
});
