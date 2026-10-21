// Measures how long a project takes to show up: when its DBML code is on screen and when its graph is.
//
//   PERF_EMAIL=… PERF_PASSWORD=… node scripts/perf/measure-open.mjs --label 00-baseline
//     [--project DeepDetect] [--runs 7] [--base http://localhost:3001] [--conditions fast,slowcpu,cold4g]
//
// Needs the web app built (`npm run build`) and served by the server (`npm start` or the dev server on
// :3001), and a project of that name the account can open. Results go to docs/perf/open-project/<label>.json.
//
// What is timed, from the start of the navigation to a `/project/:id` link:
//   codeVisible        first painted frame where the DBML editor holds the schema's text
//   graphFirstVisible  first painted frame where at least one table is on the canvas
//   graphComplete      first painted frame after the canvas stopped changing (all tables, relations, fit)
// "Painted" comes from the screencast: the first frame at or after the moment the DOM reached that state.
//
// Conditions:
//   fast     this machine, HTTP cache warm (a re-open)
//   slowcpu  CPU throttled 4x (a much slower laptop), cache warm
//   cold4g   this machine, nothing cached, network limited to 9 Mbit/s with 50 ms latency (a first visit)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []),
);
const LABEL = args.label ?? "run";
const PROJECT = args.project ?? "DeepDetect";
const RUNS = Number(args.runs ?? 7);
const BASE = args.base ?? "http://localhost:3001";
const EMAIL = process.env.PERF_EMAIL;
const PASSWORD = process.env.PERF_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Set PERF_EMAIL and PERF_PASSWORD (an account that can open the project).");

const CONDITIONS = {
  fast: { cpu: 1, cold: false, net: null },
  slowcpu: { cpu: 4, cold: false, net: null },
  cold4g: { cpu: 1, cold: true, net: { latency: 50, down: (9 * 1e6) / 8, up: (3 * 1e6) / 8 } },
};
const wanted = (args.conditions ?? "fast,slowcpu,cold4g").split(",");

/** Runs in the page before anything else: cheap live collections, read on every frame. */
const INIT = () => {
  const T = (window.__perf = { events: [], lt: [], ws: null });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => T.lt.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", () => { if (T.ws === null) T.ws = performance.now(); }, { once: true });
    }
  };
  const live = {
    nodes: document.getElementsByClassName("svelte-flow__node"),
    edges: document.getElementsByClassName("svelte-flow__edge"),
    flow: document.getElementsByClassName("svelte-flow"),
    content: document.getElementsByClassName("cm-content"),
  };
  let last = {};
  const tick = () => {
    const now = performance.now();
    const s = { nodes: live.nodes.length, edges: live.edges.length };
    const vp = live.flow[0]?.getElementsByClassName("svelte-flow__viewport")[0];
    s.vp = vp ? vp.style.transform : "";
    s.code = (live.content[0]?.textContent.length ?? 0) > 500 ? 1 : 0;
    for (const k of Object.keys(s)) if (s[k] !== last[k]) T.events.push([now, k, s[k]]);
    last = s;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const median = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const quantile = (a, q) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : null; };

async function login(ctx) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD }, headers: { origin: BASE } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}

async function openOnce(browser, cond, ctx) {
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (cond.net) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: cond.net.latency, downloadThroughput: cond.net.down, uploadThroughput: cond.net.up });
  if (cond.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cond.cpu });
  await cdp.send("Page.enable");
  let requests = 0, bytes = 0;
  cdp.on("Network.requestWillBeSent", () => requests++);
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; });
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => { frames.push(f.metadata.timestamp * 1000); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await page.goto("about:blank");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 1 });
  await page.goto(`${BASE}/project/${cond.projectId}`, { waitUntil: "commit" });
  const started = Date.now();
  let settled = false;
  while (Date.now() - started < 90000) {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const t = window.__perf; if (!t) return null;
      let last = 0; for (const e of t.events) last = Math.max(last, e[0]);
      return { now: performance.now(), last, nodes: document.getElementsByClassName("svelte-flow__node").length };
    }).catch(() => null);
    if (s && s.nodes > 0 && s.now - s.last > 1500) { settled = true; break; }
  }
  await cdp.send("Page.stopScreencast");
  const m = await page.evaluate(() => {
    const t = window.__perf;
    const first = (k, p = (v) => v > 0) => t.events.find((e) => e[1] === k && p(e[2]))?.[0] ?? null;
    const lastOf = (...ks) => t.events.filter((e) => ks.includes(e[1])).reduce((a, e) => Math.max(a, e[0]), 0);
    const complete = lastOf("nodes", "edges", "vp");
    const lt = t.lt.filter((x) => x[0] <= complete);
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      origin: performance.timeOrigin,
      codeDom: first("code"), firstNodeDom: first("nodes"), completeDom: complete,
      fcp: performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? null,
      wsFirstMessage: t.ws, nodes: document.getElementsByClassName("svelte-flow__node").length, edges: document.getElementsByClassName("svelte-flow__edge").length,
      longTasks: lt.length, longTaskMs: lt.reduce((a, x) => a + x[1], 0), longestMs: Math.max(0, ...lt.map((x) => x[1])),
      domElements: document.getElementsByTagName("*").length,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null,
      domContentLoaded: nav.domContentLoadedEventEnd,
    };
  });
  await page.close();
  const painted = (domMs) => { if (domMs == null) return null; const t = m.origin + domMs; const f = frames.find((x) => x >= t); return f ? Math.round(f - m.origin) : null; };
  return {
    settled, ...m,
    codeVisible: painted(m.codeDom), graphFirstVisible: painted(m.firstNodeDom), graphComplete: painted(m.completeDom),
    requests, transferKB: Math.round(bytes / 1024),
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ channel: "msedge", headless: true }));
const sha = (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return null; } })();
const result = { label: LABEL, commit: sha, date: new Date().toISOString(), project: PROJECT, runs: RUNS, base: BASE, browser: browser.version(), conditions: {} };

for (const name of wanted) {
  const cond = { ...CONDITIONS[name] };
  const raw = [];
  let ctx = null;
  const fresh = async () => {
    const c = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await login(c);
    const list = await (await c.request.get(`${BASE}/api/projects`)).json();
    cond.projectId = (list.projects ?? list).find((p) => p.name === PROJECT)?.id;
    if (!cond.projectId) throw new Error(`project "${PROJECT}" not found`);
    return c;
  };
  if (!cond.cold) {
    ctx = await fresh();
    await openOnce(browser, { ...cond, cpu: 1, net: null }, ctx); // warm the HTTP cache once, not measured
  }
  for (let i = 0; i < RUNS; i++) {
    const c = cond.cold ? await fresh() : ctx;
    raw.push(await openOnce(browser, cond, c));
    if (cond.cold) await c.close();
    process.stdout.write(`${name} ${i + 1}/${RUNS} code ${raw.at(-1).codeVisible} graph ${raw.at(-1).graphComplete}\n`);
  }
  if (ctx) await ctx.close();
  const keys = ["fcp", "wsFirstMessage", "codeVisible", "graphFirstVisible", "graphComplete", "codeDom", "firstNodeDom", "completeDom", "longTasks", "longTaskMs", "longestMs", "domElements", "heapMB", "requests", "transferKB"];
  result.conditions[name] = {
    cpu: cond.cpu, cold: cond.cold, net: cond.net ? { latencyMs: cond.net.latency, downMbit: (cond.net.down * 8) / 1e6 } : null,
    median: Object.fromEntries(keys.map((k) => [k, (() => { const v = median(raw.map((r) => r[k])); return v == null ? null : Math.round(v * 10) / 10; })()])),
    p25: Object.fromEntries(keys.slice(2, 5).map((k) => [k, quantile(raw.map((r) => r[k]), 0.25)])),
    p75: Object.fromEntries(keys.slice(2, 5).map((k) => [k, quantile(raw.map((r) => r[k]), 0.75)])),
    unsettledRuns: raw.filter((r) => !r.settled).length,
    raw,
  };
}
await browser.close();

const outDir = path.resolve("docs/perf/open-project");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${LABEL}.json`), JSON.stringify(result, null, 1));
console.log(`\n${LABEL} (${sha})`);
for (const [name, c] of Object.entries(result.conditions)) {
  const m = c.median;
  console.log(`${name.padEnd(8)} code ${String(m.codeVisible).padStart(5)} ms | graph first ${String(m.graphFirstVisible).padStart(5)} | graph complete ${String(m.graphComplete).padStart(5)} | long tasks ${m.longTasks} (${Math.round(m.longTaskMs)} ms, max ${Math.round(m.longestMs)}) | ${m.requests} req ${m.transferKB} KB | heap ${m.heapMB} MB`);
}
