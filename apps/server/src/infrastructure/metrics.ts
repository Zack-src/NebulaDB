import { db } from "./db.js";
import { getPerfReport } from "./perf.js";
import { liveRoomCount, totalConnectionCount } from "../realtime/roomRegistry.js";
import { getErrorCountsSinceBoot } from "../shared/errorLog.js";

/**
 * `/api/metrics` in Prometheus text format, built from what the server already tracks in
 * memory. No authentication, like `/api/health`: put it behind the reverse proxy if needed.
 */

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function gauge(name: string, help: string, value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`;
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  lines.push(gauge("nebuladb_uptime_seconds", "Process uptime in seconds.", Math.round(process.uptime())));

  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
    lines.push(gauge("nebuladb_projects_total", "Total projects in the database.", row.n));
  } catch {
    // Same failure this endpoint exists to surface — reported as an absent
    // metric rather than a 503, since the rest of the metrics below don't
    // depend on the database and are still worth scraping.
  }

  lines.push(gauge("nebuladb_rooms_active", "Live in-memory collaboration rooms.", liveRoomCount()));
  lines.push(
    gauge("nebuladb_ws_connections_active", "Live WebSocket connections across all rooms.", totalConnectionCount()),
  );

  const errorCounts = getErrorCountsSinceBoot();
  lines.push(
    "# HELP nebuladb_errors_total Errors recorded since process start, by source.\n" +
      "# TYPE nebuladb_errors_total counter\n" +
      Object.entries(errorCounts)
        .map(([source, count]) => `nebuladb_errors_total{source="${escapeLabelValue(source)}"} ${count}`)
        .join("\n") +
      "\n",
  );

  const perfRows = getPerfReport();
  if (perfRows.length > 0) {
    const label = (l: string) => `label="${escapeLabelValue(l)}"`;
    lines.push(
      "# HELP nebuladb_hotpath_duration_ms_total Cumulative time spent in an instrumented hot path since process start.\n" +
        "# TYPE nebuladb_hotpath_duration_ms_total counter\n" +
        perfRows.map((r) => `nebuladb_hotpath_duration_ms_total{${label(r.label)}} ${r.totalMs}`).join("\n") +
        "\n",
    );
    lines.push(
      "# HELP nebuladb_hotpath_calls_total Calls to an instrumented hot path since process start.\n" +
        "# TYPE nebuladb_hotpath_calls_total counter\n" +
        perfRows.map((r) => `nebuladb_hotpath_calls_total{${label(r.label)}} ${r.count}`).join("\n") +
        "\n",
    );
    lines.push(
      "# HELP nebuladb_hotpath_duration_ms_max Slowest single call to an instrumented hot path since process start — persistence.saveSnapshot is the one to watch for snapshot-write latency.\n" +
        "# TYPE nebuladb_hotpath_duration_ms_max gauge\n" +
        perfRows.map((r) => `nebuladb_hotpath_duration_ms_max{${label(r.label)}} ${r.maxMs}`).join("\n") +
        "\n",
    );
  }

  return lines.join("\n");
}
