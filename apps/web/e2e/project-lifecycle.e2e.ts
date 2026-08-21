import { test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

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
 * by `playwright-core`'s channel-based launch (see `launchBrowser` below —
 * same approach as `scripts/bench-web.mjs`, which already depends on this).
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
// Not 4190: it's on the Fetch spec's forbidden-ports list (ManageSieve,
// RFC 5804) — `fetch()` refuses to connect to it at all, which cost real
// time to track down the first time this test was written.
const PORT = Number(process.env.E2E_PORT) || 4390;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "e2e-admin@example.com";
const ADMIN_PASSWORD = "correct horse battery staple e2e";
const STARTUP_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs a built server-side script (bootstrap-admin, the server itself) with a fresh DB, inheriting stdio only on failure. */
function runNodeScript(scriptRelPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, scriptRelPath), ...args], { env, cwd: REPO_ROOT });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptRelPath} exited ${code}\n${output}`));
    });
    child.on("error", reject);
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`server never became healthy at ${BASE_URL}: ${lastErr}`);
}

async function launchBrowser(): Promise<Browser> {
  const candidates = [{ channel: "chrome" }, { channel: "msedge" }];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await chromium.launch({ headless: process.env.E2E_HEADED !== "1", ...candidate });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByLabel("Adresse e-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // The dashboard's "new project" button is the reliable signal that the
  // session actually landed — waiting on it also waits out the login request.
  await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor({ timeout: 10_000 });
}

test("create project → add a table on the canvas → reload → the table is still there", { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATHANORDB_DB_PATH: join(dataDir, "athanordb.sqlite"),
    ATHANORDB_COOKIE_SECURE: "false",
    ATHANORDB_SECRET: "e2e-test-secret-do-not-use-in-production",
    ATHANORDB_LOG_LEVEL: "silent",
    PORT: String(PORT),
    NODE_ENV: "production",
  };

  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    await runNodeScript("apps/server/dist/bootstrap-admin.js", [ADMIN_EMAIL, ADMIN_PASSWORD], env);

    server = spawn(process.execPath, [join(REPO_ROOT, "apps/server/dist/index.js")], { env, cwd: REPO_ROOT });
    let serverOutput = "";
    server.stdout?.on("data", (d) => (serverOutput += d));
    server.stderr?.on("data", (d) => (serverOutput += d));
    const serverExited = new Promise<never>((_resolve, reject) => {
      server!.on("exit", (code) => reject(new Error(`server exited early (code ${code})\n${serverOutput}`)));
      server!.on("error", (err) => reject(new Error(`server failed to spawn: ${err}\n${serverOutput}`)));
    });
    try {
      await Promise.race([waitForHealth(), serverExited]);
    } catch (err) {
      throw new Error(`${err}\n--- server output so far ---\n${serverOutput}`, { cause: err });
    }

    browser = await launchBrowser();
    const page = await browser.newPage();

    await login(page);

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
    await browser?.close().catch(() => {});
    if (server && !server.killed) {
      server.kill();
      await new Promise((resolve) => server!.once("exit", resolve)).catch(() => {});
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
