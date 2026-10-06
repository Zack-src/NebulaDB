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
 *   node scripts/bench-web.mjs --tag slow-pc --matrix quick --cpu 6
 *
 * `--cpu N` slows the main thread N× (CDP CPU throttling) — the way to see on
 * a fast dev machine what a modest laptop sees. `--profile` adds, per
 * scenario, the functions with the most self time (build with
 * `BENCH_READABLE=1` so their names survive minification).
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
/** Main-thread slowdown factor; 1 = this machine as it is. */
const CPU = Number(flag("cpu", 1)) || 1;
const PROFILE = args.includes("--profile");
/** Per scenario, main-thread self time by kind of renderer work (style, layout, paint, hit test…). */
const TRACE = args.includes("--trace");
/** A stylesheet injected into the page — tries a CSS hypothesis without a rebuild. */
const CSS_FILE = flag("css", null);
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
  // Explicit list, e.g. `--configs 100:8:full,200:8:standard`.
  const explicit = flag("configs", null);
  if (explicit) {
    return String(explicit)
      .split(",")
      .map((entry) => entry.split(":"))
      .map(([tables, columns, detail]) => ({ tables: Number(tables), columns: Number(columns), detail }));
  }
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
  page.evaluate(
    () => document.querySelector(".svelte-flow__viewport, .react-flow__viewport")?.getAttribute("style") ?? "",
  );

/** Cumulative main-thread seconds per kind of work, as the renderer itself accounts them. */
async function readMainThread(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    task: value("TaskDuration"),
    script: value("ScriptDuration"),
    layout: value("LayoutDuration"),
    style: value("RecalcStyleDuration"),
  };
}

/** The functions with the most self time in a CPU profile, heaviest first. */
function topSelfTime(profile, limit = 14) {
  const interval = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0) / Math.max(1, profile.samples.length);
  const hits = new Map();
  for (const id of profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1);
  const byFunction = new Map();
  const parents = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node);
  const describe = ({ functionName, url, lineNumber }) =>
    `${functionName || "(anonymous)"} ${url.split("/").pop()}:${lineNumber + 1}`;
  for (const node of profile.nodes) {
    const count = hits.get(node.id);
    if (!count) continue;
    const { functionName, url } = node.callFrame;
    if (functionName === "(idle)" || functionName === "(program)") continue;
    let key = describe(node.callFrame);
    // A DOM builtin (`getBoundingClientRect`…) says nothing by itself: name
    // the nearest script function that called it.
    if (!url) {
      let caller = parents.get(node.id);
      while (caller && !caller.callFrame.url) caller = parents.get(caller.id);
      if (caller && byId.has(caller.id)) key = `${functionName} ← ${describe(caller.callFrame)}`;
    }
    byFunction.set(key, (byFunction.get(key) ?? 0) + count);
  }
  return [...byFunction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([fn, count]) => ({ fn, selfMs: Math.round((count * interval) / 100) / 10 }));
}

/**
 * Self time per trace event name on the renderer's main thread — what the
 * `other` bucket of `mainThread` is actually made of.
 */
function traceSelfTime(buffer, limit = 14) {
  const events = JSON.parse(buffer.toString("utf8")).traceEvents;
  const mainThreads = new Set(
    events
      .filter((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain")
      .map((event) => `${event.pid}:${event.tid}`),
  );
  const complete = events
    .filter((event) => event.ph === "X" && event.dur && mainThreads.has(`${event.pid}:${event.tid}`))
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  const close = (event) => self.set(event.name, (self.get(event.name) ?? 0) + event.dur - event.childDur);
  for (const event of complete) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= event.ts) close(stack.pop());
    if (stack.length) stack[stack.length - 1].childDur += event.dur;
    event.childDur = 0;
    stack.push(event);
  }
  while (stack.length) close(stack.pop());
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, micros]) => ({ name, selfMs: Math.round(micros / 100) / 10 }));
}

/** Opens a measurement window, runs `action`, then closes it on a real paint. */
async function measure(page, cdp, label, action) {
  if (TRACE) {
    await page
      .context()
      .browser()
      .startTracing(page, {
        categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "v8"],
      });
  }
  if (PROFILE) await cdp.send("Profiler.start");
  const before = await readMainThread(cdp);
  await page.evaluate((name) => window.__nebulaBench.start(name), label);
  await action();
  await page.evaluate(() => window.__nebulaBench.frames(3));
  await sleep(400);
  const metrics = await page.evaluate(() => window.__nebulaBench.stop());
  const after = await readMainThread(cdp);
  const ms = (key) => Math.round((after[key] - before[key]) * 1000);
  // `other` is what the main thread did that was neither script nor
  // style/layout: paint, compositing updates, hit testing, GC.
  metrics.mainThread = {
    taskMs: ms("task"),
    scriptMs: ms("script"),
    styleMs: ms("style"),
    layoutMs: ms("layout"),
    otherMs: Math.max(0, ms("task") - ms("script") - ms("style") - ms("layout")),
  };
  if (PROFILE) metrics.profileTop = topSelfTime((await cdp.send("Profiler.stop")).profile);
  if (TRACE) metrics.traceTop = traceSelfTime(await page.context().browser().stopTracing());
  return metrics;
}

/**
 * Proves the synthetic input actually reaches the flow library (Svelte Flow; React Flow for the pre-migration baseline) before anything is
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
  const box = await page.locator(`:is(.svelte-flow__node, .react-flow__node)[data-id="${tableId}"]`).boundingBox();
  if (!box) throw new Error(`node ${tableId} not on screen`);
  return { x: box.x + box.width / 2, y: box.y + 12 };
}

async function runScenarios(page, cdp) {
  const results = [];
  const pane = await page.locator(".svelte-flow__pane, .react-flow__pane").boundingBox();
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
    results.push(await measure(page, cdp, label, action));
  };

  // 1. Zoom out then back in (ctrl+wheel — the canvas maps plain wheel to pan).
  await record("zoom", zoomGesture);
  // The same gesture a second time: the first pass also pays for tables being
  // laid out and measured as they first come into view; this one is the
  // steady state a user zooming back and forth lives in.
  await record("zoom-again", zoomGesture);

  // 1a. Pan (plain wheel) — the most frequent gesture of all on a big schema.
  await record("pan", async () => {
    await page.mouse.move(center.x, center.y);
    for (const delta of [120, -120]) {
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, delta);
        await sleep(30);
      }
    }
  });

  // 1a'. Sweep the pointer across the tables without pressing anything: every
  //      row and table entered fires its hover handlers.
  await record("hover-sweep", async () => {
    for (let pass = 0; pass < 3; pass++) {
      for (let step = 0; step <= 40; step++) {
        const ratio = pass % 2 === 0 ? step / 40 : 1 - step / 40;
        await page.mouse.move(
          pane.x + 40 + (pane.width - 80) * ratio,
          pane.y + 80 + ((pane.height - 160) * (pass + 0.5)) / 3,
        );
        await sleep(12);
      }
    }
  });

  // 1b. The same gesture with every relation highlighted and animated, which
  //     is how a user reading a schema actually leaves the canvas.
  if (isWanted("zoom-links-on")) {
    await linkToggle.click();
    await sleep(1500);
    await record("zoom-links-on", zoomGesture);
    // Doing nothing at all, with every relation animated: anything the main
    // thread spends here is spent for as long as the canvas stays open.
    await record("idle-links-on", () => sleep(1500));
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
      await page.mouse.move(
        pane.x + 30 + (pane.width * 0.8 * step) / 12,
        pane.y + 30 + (pane.height * 0.8 * step) / 12,
      );
      await sleep(20);
    }
    await page.mouse.up();
  });
  const selectableIds = await page.$$eval(".svelte-flow__node.selected, .react-flow__node.selected", (nodes) =>
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
    await page.evaluate((indexes) => window.__nebulaBench.setTablesColor(indexes, "#ef4444"), selectedIndexes);
  });
  await record("recolor-single", async () => {
    await page.evaluate(() => window.__nebulaBench.setTablesColor([0], "#22c55e"));
  });

  // 7. Column property flip (pk), the popover's own write.
  await record("column-flag", async () => {
    await page.evaluate(() => window.__nebulaBench.toggleFieldFlag(0, 2, "pk"));
  });

  // 8. Link/cardinality highlight toggle — the real toolbar button.
  await record("highlight-toggle", async () => {
    await linkToggle.click();
    await sleep(500);
    await linkToggle.click();
  });

  // 9. Column deletion (3 columns off one table, each removing its refs).
  await record("delete-columns", async () => {
    await page.evaluate(() => window.__nebulaBench.deleteColumns(1, 3));
  });

  return results;
}

async function benchConfig(browser, config) {
  const context = await browser.newContext({ viewport: WINDOW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (PROFILE) await cdp.send("Profiler.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.addInitScript(
    ([viewport]) => {
      localStorage.setItem("nebuladb.viewport.bench-local.bench-user", JSON.stringify(viewport));
      localStorage.setItem("nebula:perf", "1");
    },
    [VIEWPORT],
  );

  const url = `${BASE_URL}/#bench?tables=${config.tables}&columns=${config.columns}&detail=${config.detail}`;
  const loadStart = Date.now();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__nebulaBench), null, { timeout: 60_000 });
  if (CSS_FILE) await page.addStyleTag({ path: path.resolve(String(CSS_FILE)) });
  const ready = await page.evaluate((expected) => window.__nebulaBench.ready(expected), config.tables);
  const loadMs = Date.now() - loadStart;
  // Let the initial mount, DBML serialization and edge routing settle before
  // the first measured gesture.
  await sleep(2000);

  const scenarios = await runScenarios(page, cdp);
  await context.close();
  return { config, loadMs, ready, scenarios };
}

function formatMarkdown(tag, results) {
  const lines = [
    `# Canvas perf benchmark — \`${tag}\``,
    "",
    `Run: ${new Date().toISOString()} · window ${WINDOW.width}×${WINDOW.height} · zoom ${VIEWPORT.zoom} · CPU ×${CPU}`,
    "",
    "Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms, **script/style/layout/other** = main-thread ms by kind of work (other = paint, hit testing, GC).",
    "",
  ];
  for (const entry of results) {
    const { config, loadMs, ready } = entry;
    lines.push(
      `## ${config.tables} tables · ${config.columns} columns · ${config.detail}`,
      "",
      `Load+mount: ${loadMs}ms (${ready.nodes} nodes, ${ready.edges} edges in DOM)`,
      "",
      "| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const scenario of entry.scenarios) {
      lines.push(
        `| ${scenario.label} | ${scenario.totalBlockingMs} | ${scenario.longTasks.count} | ${scenario.longTasks.maxMs} | ${scenario.frames.p95Ms} | ${scenario.frames.maxMs} | ${scenario.frames.droppedFrames} | ${scenario.frames.fps} | ${scenario.mainThread.scriptMs} | ${scenario.mainThread.styleMs} | ${scenario.mainThread.layoutMs} | ${scenario.mainThread.otherMs} |`,
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
            `lt ${String(scenario.longTasks.count).padStart(3)}  p95 ${String(scenario.frames.p95Ms).padStart(6)}ms  worst ${String(scenario.frames.maxMs).padStart(6)}ms  ` +
            `js ${String(scenario.mainThread.scriptMs).padStart(5)} style ${String(scenario.mainThread.styleMs).padStart(5)} ` +
            `layout ${String(scenario.mainThread.layoutMs).padStart(5)} other ${String(scenario.mainThread.otherMs).padStart(5)}\n`,
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
  await writeFile(
    jsonPath,
    JSON.stringify({ tag: TAG, window: WINDOW, viewport: VIEWPORT, cpu: CPU, results }, null, 2),
  );
  await writeFile(mdPath, formatMarkdown(TAG, results));
  process.stdout.write(`\nWrote ${path.relative(ROOT, jsonPath)} and ${path.relative(ROOT, mdPath)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
