#!/usr/bin/env node
/**
 * Compares two `scripts/bench-web.mjs` reports scenario by scenario and prints
 * a Markdown table (plus a JSON summary with `--json`).
 *
 *   node scripts/bench-compare.mjs docs/perf/bench-react-baseline.json docs/perf/bench-svelte.json
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
if (!beforePath || !afterPath) {
  console.error("usage: bench-compare.mjs <before.json> <after.json> [--json]");
  process.exit(1);
}

const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const configKey = (c) => `${c.tables} tables · ${c.columns} columns · ${c.detail}`;
const afterByConfig = new Map(after.results.map((r) => [configKey(r.config), r]));

const pct = (b, a) => (b === 0 ? (a === 0 ? "=" : "+∞") : `${a - b > 0 ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const rows = [];
const totals = { blockingBefore: 0, blockingAfter: 0, loadBefore: 0, loadAfter: 0, dropsBefore: 0, dropsAfter: 0 };
const out = [];
out.push(`# Canvas perf — \`${before.tag}\` → \`${after.tag}\``, "");
for (const b of before.results) {
  const key = configKey(b.config);
  const a = afterByConfig.get(key);
  if (!a) continue;
  totals.loadBefore += b.loadMs;
  totals.loadAfter += a.loadMs;
  out.push(`## ${key}`, "", `Load+mount: ${b.loadMs}ms → ${a.loadMs}ms (${pct(b.loadMs, a.loadMs)})`, "");
  out.push("| scenario | blocking ms | Δ | frame p95 | worst frame | drops |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  const afterScenarios = new Map(a.scenarios.map((s) => [s.label, s]));
  for (const sb of b.scenarios) {
    const sa = afterScenarios.get(sb.label);
    if (!sa) continue;
    totals.blockingBefore += sb.totalBlockingMs;
    totals.blockingAfter += sa.totalBlockingMs;
    totals.dropsBefore += sb.frames.droppedFrames;
    totals.dropsAfter += sa.frames.droppedFrames;
    rows.push({ config: key, scenario: sb.label, before: sb, after: sa });
    out.push(
      `| ${sb.label} | ${fmt(sb.totalBlockingMs)} → ${fmt(sa.totalBlockingMs)} | ${pct(sb.totalBlockingMs, sa.totalBlockingMs)} | ` +
        `${fmt(sb.frames.p95Ms)} → ${fmt(sa.frames.p95Ms)} | ${fmt(sb.frames.maxMs)} → ${fmt(sa.frames.maxMs)} | ` +
        `${sb.frames.droppedFrames} → ${sa.frames.droppedFrames} |`,
    );
  }
  out.push("");
}
out.push(
  "## Totals",
  "",
  `- Blocking time (sum over all scenarios): ${Math.round(totals.blockingBefore)}ms → ${Math.round(totals.blockingAfter)}ms (${pct(totals.blockingBefore, totals.blockingAfter)})`,
  `- Load+mount (sum over all configs): ${totals.loadBefore}ms → ${totals.loadAfter}ms (${pct(totals.loadBefore, totals.loadAfter)})`,
  `- Dropped frames (sum): ${totals.dropsBefore} → ${totals.dropsAfter}`,
);

console.log(asJson ? JSON.stringify({ totals, rows: rows.map((r) => ({ config: r.config, scenario: r.scenario, blockingBefore: r.before.totalBlockingMs, blockingAfter: r.after.totalBlockingMs, p95Before: r.before.frames.p95Ms, p95After: r.after.frames.p95Ms, worstBefore: r.before.frames.maxMs, worstAfter: r.after.frames.maxMs, dropsBefore: r.before.frames.droppedFrames, dropsAfter: r.after.frames.droppedFrames })), loads: before.results.map((b) => ({ config: configKey(b.config), before: b.loadMs, after: afterByConfig.get(configKey(b.config))?.loadMs })) }, null, 1) : out.join("\n"));
