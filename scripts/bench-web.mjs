#!/usr/bin/env node
/**
 * Canvas perf benchmark driver.
 *
 * Builds the web app, serves it with `vite preview`, then drives the perf
 * harness (`apps/web/src/features/editor/bench`, reachable at `/#bench`) with
 * real CDP-level mouse/keyboard input across a matrix of table counts, column
 * counts and detail levels — the same gestures users report as slow: zoom,
 * dragging one or many tables, recolouring, toggling a column flag, toggling
 * link highlighting, deleting columns.
 *
 * Per scenario it records frame pacing (avg/p95/worst frame, dropped frames),
 * long tasks and total blocking time, plus the app's own `perfMonitor` spans,
 * and writes both a JSON file and a Markdown summary under `docs/perf/`.
 *
 * Usage:
 *   node scripts/bench-web.mjs --tag before
 *   node scripts/bench-web.mjs --tag after --skip-build
 *   node scripts/bench-web.mjs --tag quick --matrix quick
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BENCH_PORT) || 4180;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(ROOT, "docs", "perf");

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? true);
};
const TAG = flag("tag", "run");
const SKIP_BUILD = args.includes("--skip-build");
const HEADED = args.includes("--headed");
const MATRIX = flag("matrix", "full");
/** Optional comma-separated scenario allowlist, e.g. `--only select-multi,drag-multi`. */
const ONLY = flag("only", null);
const wanted = ONLY ? new Set(String(ONLY).split(",")) : null;
const isWanted = (label) => !wanted || wanted.has(label);

/**
 * How this canvas actually multi-selects: a left-drag over empty space
 * (`selectionOnDrag`, with panning moved to the middle/right button). Probed
 * rather than assumed — modifier-clicking does *not* extend the selection
 * here, so a bench built on ctrl/shift-click was measuring eight independent
 * single selections instead of one growing multi-selection.
 */

/** Fixed viewport so every config starts framed identically (~20 tables on screen). */
const VIEWPORT = { x: 100, y: 100, zoom: 0.6 };
const WINDOW = { width: 1600, height: 900 };

const DETAIL_LEVELS = ["full", "standard", "compact"];
const TABLE_COUNTS = [10, 50, 100, 200, 500];

function buildMatrix() {
  const configs = [];
  if (MATRIX === "quick") {
    for (const tables of [100, 500]) configs.push({ tables, columns: 8, detail: "standard" });
    return configs;
  }
  if (MATRIX === "multi") {
    // The configs where multi-selection actually hurt, per the full matrix.
    return [
      { tables: 200, columns: 8, detail: "full" },
      { tables: 500, columns: 8, detail: "standard" },
      { tables: 500, columns: 8, detail: "full" },
    ];
  }
  for (const tables of TABLE_COUNTS) {
    for (const detail of DETAIL_LEVELS) configs.push({ tables, columns: 8, detail });
  }
  // Column-count sweep: how much of the cost is per-table vs per-column.
  for (const columns of [4, 16, 32]) configs.push({ tables: 100, columns, detail: "standard" });
  return configs;
}

function run(command, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, { cwd: ROOT, stdio: "inherit", shell: true, ...options });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    child.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

/**
 * Serves `apps/web/dist` in this process. `vite preview` would do the same
 * job, but only as a detached npm→vite process tree that survives being
 * killed on Windows and then holds the port for the next run.
 */
async function startServer() {
  const dist = path.join(ROOT, "apps", "web", "dist");
  const server = createServer(async (req, res) => {
    const requested = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const candidate = path.join(dist, requested);
    const file = candidate.startsWith(dist) && path.extname(candidate) ? candidate : path.join(dist, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, resolve);
  });
  return server;
}

async function launchBrowser() {
  const candidates = [
    { channel: "chrome" },
    { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" },
    { channel: "msedge" },
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await chromium.launch({ headless: !HEADED, ...candidate });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** The canvas transform, so a scenario can prove the gesture actually did something. */
const readTransform = (page) =>
  page.evaluate(() => document.querySelector(".react-flow__viewport")?.getAttribute("style") ?? "");

/** Opens a measurement window, runs `action`, then closes it on a real paint. */
async function measure(page, label, action) {
  await page.evaluate((name) => window.__athanorBench.start(name), label);
  await action();
  await page.evaluate(() => window.__athanorBench.frames(3));
  await sleep(400);
  return page.evaluate(() => window.__athanorBench.stop());
}

/**
 * Proves the synthetic input actually reaches React Flow before anything is
 * measured — a gesture the canvas ignores would otherwise be reported as a
 * beautifully fast scenario.
 */
async function assertInputReaches(page, center) {
  const before = await readTransform(page);
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 240);
  await page.keyboard.up("Control");
  await sleep(400);
  const after = await readTransform(page);
  if (before === after) throw new Error("bench: ctrl+wheel did not change the canvas transform");
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await sleep(400);
}

async function nodeCenter(page, tableId) {
  const box = await page.locator(`.react-flow__node[data-id="${tableId}"]`).boundingBox();
  if (!box) throw new Error(`node ${tableId} not on screen`);
  return { x: box.x + box.width / 2, y: box.y + 12 };
}

async function runScenarios(page) {
  const results = [];
  const pane = await page.locator(".react-flow__pane").boundingBox();
  const center = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
  const linkToggle = page.locator('[data-testid="toggle-link-highlight"]');

  const zoomGesture = async () => {
    await page.mouse.move(center.x, center.y);
    await page.keyboard.down("Control");
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 120);
      await sleep(30);
    }
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -120);
      await sleep(30);
    }
    await page.keyboard.up("Control");
  };

  await assertInputReaches(page, center);

  /** Runs and records a scenario unless `--only` filtered it out. */
  const record = async (label, action) => {
    if (!isWanted(label)) return;
    results.push(await measure(page, label, action));
  };

  // 1. Zoom out then back in (ctrl+wheel — the canvas maps plain wheel to pan).
  await record("zoom", zoomGesture);

  // 1b. The same gesture with every relation highlighted and animated, which
  //     is how a user reading a schema actually leaves the canvas.
  if (isWanted("zoom-links-on")) {
    await linkToggle.click();
    await sleep(1500);
    await record("zoom-links-on", zoomGesture);
    await linkToggle.click();
    await sleep(1500);
  }

  // 2. Drag one table.
  const first = await nodeCenter(page, "t0");
  await record("drag-single", async () => {
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(first.x + i * 4, first.y + i * 2);
        await sleep(12);
      }
      await page.mouse.up();
  });

  // 3. Multi-select: rubber-band over most of the visible canvas — the
  //    gesture before every bulk action below.
  await record("select-multi", async () => {
    await page.mouse.move(pane.x + 30, pane.y + 30);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(pane.x + 30 + (pane.width * 0.8 * step) / 12, pane.y + 30 + (pane.height * 0.8 * step) / 12);
      await sleep(20);
    }
    await page.mouse.up();
  });
  const selectableIds = await page.$$eval(".react-flow__node.selected", (nodes) =>
    nodes.map((node) => node.getAttribute("data-id")).filter((id) => id?.startsWith("t")),
  );
  if (isWanted("select-multi") && selectableIds.length < 2) {
    throw new Error(`bench: rubber-band selected ${selectableIds.length} nodes, expected several`);
  }

  // 4. Drag the whole selection.
  if (selectableIds.length > 0) {
    const anchor = await nodeCenter(page, selectableIds[0]);
    await record("drag-multi", async () => {
      await page.mouse.move(anchor.x, anchor.y);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(anchor.x + i * 4, anchor.y + i * 2);
        await sleep(12);
      }
      await page.mouse.up();
    });
  }

  // 5/6. Recolour — the exact doc write the colour pickers perform, for the
  //      whole selection and then for a single table.
  const selectedIndexes = selectableIds.map((id) => Number(id.slice(1)));
  await record("recolor-multi", async () => {
    await page.evaluate((indexes) => window.__athanorBench.setTablesColor(indexes, "#ef4444"), selectedIndexes);
  });
  await record("recolor-single", async () => {
    await page.evaluate(() => window.__athanorBench.setTablesColor([0], "#22c55e"));
  });

  // 7. Column property flip (pk), the popover's own write.
  await record("column-flag", async () => {
    await page.evaluate(() => window.__athanorBench.toggleFieldFlag(0, 2, "pk"));
  });

  // 8. Link/cardinality highlight toggle — the real toolbar button.
  await record("highlight-toggle", async () => {
    await linkToggle.click();
    await sleep(500);
    await linkToggle.click();
  });

  // 9. Column deletion (3 columns off one table, each removing its refs).
  await record("delete-columns", async () => {
    await page.evaluate(() => window.__athanorBench.deleteColumns(1, 3));
  });

  return results;
}

async function benchConfig(browser, config) {
  const context = await browser.newContext({ viewport: WINDOW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(
    ([viewport]) => {
      localStorage.setItem("athanordb.viewport.bench-local.bench-user", JSON.stringify(viewport));
      localStorage.setItem("athanor:perf", "1");
    },
    [VIEWPORT],
  );

  const url = `${BASE_URL}/#bench?tables=${config.tables}&columns=${config.columns}&detail=${config.detail}`;
  const loadStart = Date.now();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__athanorBench), null, { timeout: 60_000 });
  const ready = await page.evaluate((expected) => window.__athanorBench.ready(expected), config.tables);
  const loadMs = Date.now() - loadStart;
  // Let the initial mount, DBML serialization and edge routing settle before
  // the first measured gesture.
  await sleep(2000);

  const scenarios = await runScenarios(page);
  await context.close();
  return { config, loadMs, ready, scenarios };
}

function formatMarkdown(tag, results) {
  const lines = [
    `# Canvas perf benchmark — \`${tag}\``,
    "",
    `Run: ${new Date().toISOString()} · window ${WINDOW.width}×${WINDOW.height} · zoom ${VIEWPORT.zoom}`,
    "",
    "Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.",
    "",
  ];
  for (const entry of results) {
    const { config, loadMs, ready } = entry;
    lines.push(
      `## ${config.tables} tables · ${config.columns} columns · ${config.detail}`,
      "",
      `Load+mount: ${loadMs}ms (${ready.nodes} nodes, ${ready.edges} edges in DOM)`,
      "",
      "| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const scenario of entry.scenarios) {
      lines.push(
        `| ${scenario.label} | ${scenario.totalBlockingMs} | ${scenario.longTasks.maxMs} | ${scenario.frames.p95Ms} | ${scenario.frames.maxMs} | ${scenario.frames.droppedFrames} | ${scenario.frames.fps} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  if (!SKIP_BUILD) await run("npm", ["run", "build", "-w", "apps/web"]);
  const server = await startServer();
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const config of buildMatrix()) {
      process.stdout.write(`▶ ${config.tables} tables / ${config.columns} cols / ${config.detail}\n`);
      const result = await benchConfig(browser, config);
      results.push(result);
      for (const scenario of result.scenarios) {
        process.stdout.write(
          `   ${scenario.label.padEnd(18)} blocking ${String(scenario.totalBlockingMs).padStart(6)}ms  ` +
            `p95 ${String(scenario.frames.p95Ms).padStart(6)}ms  worst ${String(scenario.frames.maxMs).padStart(6)}ms\n`,
        );
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `bench-${TAG}.json`);
  const mdPath = path.join(OUT_DIR, `bench-${TAG}.md`);
  await writeFile(jsonPath, JSON.stringify({ tag: TAG, window: WINDOW, viewport: VIEWPORT, results }, null, 2));
  await writeFile(mdPath, formatMarkdown(TAG, results));
  process.stdout.write(`\nWrote ${path.relative(ROOT, jsonPath)} and ${path.relative(ROOT, mdPath)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
