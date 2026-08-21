import { db } from "./db.js";
import { getPerfReport } from "./perf.js";
import { liveRoomCount, totalConnectionCount } from "../realtime/roomRegistry.js";
import { getErrorCountsSinceBoot } from "../shared/errorLog.js";

/**
 * `/api/metrics` in Prometheus text exposition format — everything the
 * server already tracks in memory (`Room`, `perf.ts`, `errorLog.ts`), turned
 * into something a scraper can read. Filled a real gap: nothing exposed
 * connection counts, room counts, or snapshot-write latency before this, and
 * this service's characteristic failure mode is "sync silently stopped" —
 * exactly the case a human doesn't notice without a metric to alert on.
 *
 * No authentication, matching `/api/health` — typical Prometheus deployments
 * scrape without sending a session cookie, and network-level access control
 * (not application auth) is the usual boundary for a metrics endpoint. If
 * that stops being true for a given deployment, put it behind the reverse
 * proxy the README already documents.
 */

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function gauge(name: string, help: string, value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`;
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  lines.push(gauge("athanordb_uptime_seconds", "Process uptime in seconds.", Math.round(process.uptime())));

  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
    lines.push(gauge("athanordb_projects_total", "Total projects in the database.", row.n));
  } catch {
    // Same failure this endpoint exists to surface — reported as an absent
    // metric rather than a 503, since the rest of the metrics below don't
    // depend on the database and are still worth scraping.
  }

  lines.push(gauge("athanordb_rooms_active", "Live in-memory collaboration rooms.", liveRoomCount()));
  lines.push(
    gauge("athanordb_ws_connections_active", "Live WebSocket connections across all rooms.", totalConnectionCount()),
  );

  const errorCounts = getErrorCountsSinceBoot();
  lines.push(
    "# HELP athanordb_errors_total Errors recorded since process start, by source.\n" +
      "# TYPE athanordb_errors_total counter\n" +
      Object.entries(errorCounts)
        .map(([source, count]) => `athanordb_errors_total{source="${escapeLabelValue(source)}"} ${count}`)
        .join("\n") +
      "\n",
  );

  const perfRows = getPerfReport();
  if (perfRows.length > 0) {
    const label = (l: string) => `label="${escapeLabelValue(l)}"`;
    lines.push(
      "# HELP athanordb_hotpath_duration_ms_total Cumulative time spent in an instrumented hot path since process start.\n" +
        "# TYPE athanordb_hotpath_duration_ms_total counter\n" +
        perfRows.map((r) => `athanordb_hotpath_duration_ms_total{${label(r.label)}} ${r.totalMs}`).join("\n") +
        "\n",
    );
    lines.push(
      "# HELP athanordb_hotpath_calls_total Calls to an instrumented hot path since process start.\n" +
        "# TYPE athanordb_hotpath_calls_total counter\n" +
        perfRows.map((r) => `athanordb_hotpath_calls_total{${label(r.label)}} ${r.count}`).join("\n") +
        "\n",
    );
    lines.push(
      "# HELP athanordb_hotpath_duration_ms_max Slowest single call to an instrumented hot path since process start — persistence.saveSnapshot is the one to watch for snapshot-write latency.\n" +
        "# TYPE athanordb_hotpath_duration_ms_max gauge\n" +
        perfRows.map((r) => `athanordb_hotpath_duration_ms_max{${label(r.label)}} ${r.maxMs}`).join("\n") +
        "\n",
    );
  }

  return lines.join("\n");
}
