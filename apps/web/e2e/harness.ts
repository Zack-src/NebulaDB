import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

/**
 * Shared boot/teardown for every `*.e2e.ts` file — spawn a real server
 * (built `apps/server/dist`) against a throwaway SQLite file, launch a real
 * Chrome/Edge via `playwright-core`, and tear both down cleanly. Factored
 * out of `project-lifecycle.e2e.ts` (the first file here) once a second and
 * third file needed the exact same ~80 lines of process/browser plumbing —
 * see that file's own header comment for why E2E exists as a separate,
 * not-part-of-`npm-test` suite at all.
 *
 * Each `*.e2e.ts` file needs its own port: `node --test` runs test files in
 * parallel by default, and two files racing to bind the same port would
 * make one fail non-deterministically depending on scheduling. Pick a
 * literal, unused-by-anything-else port per file (see the existing files
 * for the ones already taken).
 */

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const ADMIN_EMAIL = "e2e-admin@example.com";
export const ADMIN_PASSWORD = "correct horse battery staple e2e";
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

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`server never became healthy at ${baseUrl}: ${lastErr}`);
}

export async function launchBrowser(): Promise<Browser> {
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

/** Logs the seeded admin in and waits for the dashboard to be interactive. */
export async function login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.getByLabel("Adresse e-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // The dashboard's "new project" button is the reliable signal that the
  // session actually landed — waiting on it also waits out the login request.
  await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor({ timeout: 10_000 });
}

export interface E2eEnvironment {
  baseUrl: string;
  browser: Browser;
  /** Tears down the browser and server, and deletes the throwaway data directory. Always call this in a `finally`. */
  teardown: () => Promise<void>;
}

/**
 * Boots a real server (fresh SQLite, a seeded admin account) and a real
 * browser on `port`. Does not log in or open a page — most tests need a
 * fresh `page` per scenario, and the component-catalogue test needs no
 * session at all — so callers call `login(page, baseUrl)` themselves when
 * they need one.
 */
export async function startE2eEnvironment(port: number): Promise<E2eEnvironment> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATHANORDB_DB_PATH: join(dataDir, "athanordb.sqlite"),
    ATHANORDB_COOKIE_SECURE: "false",
    ATHANORDB_SECRET: "e2e-test-secret-do-not-use-in-production",
    ATHANORDB_LOG_LEVEL: "silent",
    PORT: String(port),
    NODE_ENV: "production",
  };

  let server: ChildProcess | null = null;
  let browser: Browser | null = null;

  const teardown = async () => {
    await browser?.close().catch(() => {});
    // `exitCode !== null` means the server already exited on its own (e.g. it
    // lost a port race) — waiting for an "exit" event then would hang forever.
    if (server && !server.killed && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server!.once("exit", resolve)).catch(() => {});
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

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
      await Promise.race([waitForHealth(baseUrl), serverExited]);
      // A health check can be answered by *another* file's server if two
      // files picked the same port: ours then dies with EADDRINUSE while the
      // check succeeds against the wrong process. Give the loser a moment to
      // exit, then refuse to carry on against someone else's server.
      await sleep(300);
      if (server.exitCode !== null)
        throw new Error(`server exited (code ${server.exitCode}) — is port ${port} already taken?`);
    } catch (err) {
      throw new Error(`${err}\n--- server output so far ---\n${serverOutput}`, { cause: err });
    }

    browser = await launchBrowser();
    return { baseUrl, browser, teardown };
  } catch (err) {
    await teardown();
    throw err;
  }
}
