/**
 * Server-side benchmark for the editor's actual hot paths: REST endpoints
 * driven through the real Fastify app (no network — `app.inject`, same as
 * the test suite), plus the WebSocket room's message handling driven
 * directly against `Room` with synthetic Yjs updates (no real socket needed
 * — `receive()` only touches `conn.send`/`conn.readyState`).
 *
 * Point of this script: find out where server time actually goes on a
 * *large* schema — the size that only shows up in a real customer's
 * project, not in the unit-test fixtures. Run it against a range of sizes
 * and watch which stage stops scaling linearly.
 *
 *   npm run bench -w apps/server                # default sizes
 *   npm run bench -w apps/server -- --tables=500 # one specific size
 *
 * Uses a throwaway sqlite db (same trick as app.test.ts) — never touches
 * the real dev/prod database.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-bench-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "bench-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../src/app.js");
const { db } = await import("../src/infrastructure/db.js");
const { hashPassword } = await import("../src/modules/auth/password.js");
const { getRoom, closeRoom } = await import("../src/realtime/room.js");
const { getPerfReport, resetPerfReport } = await import("../src/infrastructure/perf.js");
const syncProtocol = await import("y-protocols/sync.js");
const encoding = await import("lib0/encoding.js");
const Y = await import("yjs");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor(p * (sortedMs.length - 1)));
  return sortedMs[idx];
}

interface Timing {
  label: string;
  samples: number[];
}

function report(timings: Timing[]): void {
  const rows = timings.map(({ label, samples }) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      op: label,
      n: samples.length,
      "avg(ms)": Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10,
      "p50(ms)": Math.round(percentile(sorted, 0.5) * 10) / 10,
      "p95(ms)": Math.round(percentile(sorted, 0.95) * 10) / 10,
      "max(ms)": Math.round(Math.max(...samples) * 10) / 10,
    };
  });
  console.table(rows);
}

/** Synthetic DBML: `n` tables, each with a handful of columns and a ref to the previous table — big enough to exercise the parser/merge/import path at realistic scale, not just the tiny fixtures the unit tests use. */
function syntheticDbml(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `Table table_${i} {\n` +
        `  id integer [pk, increment]\n` +
        `  name varchar\n` +
        `  description text\n` +
        `  status varchar\n` +
        `  created_at timestamp\n` +
        `  updated_at timestamp\n` +
        (i > 0 ? `  table_${i - 1}_id integer\n` : "") +
        `}\n`,
    );
    if (i > 0) parts.push(`Ref: table_${i}.table_${i - 1}_id > table_${i - 1}.id\n`);
  }
  return parts.join("\n");
}

async function benchRest(app: Awaited<ReturnType<typeof buildApp>>, tableCount: number) {
  const email = `bench-${randomUUID()}@example.com`;
  const password = "bench-password-123!";
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, 'bench')").run(
    userId,
    email,
    await hashPassword(password),
  );

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = loginRes.cookies.find((c) => c.name === "athanordb_sid");
  const cookie = sessionCookie ? `athanordb_sid=${sessionCookie.value}` : "";

  const createRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name: `bench-${tableCount}` },
  });
  const projectId = (createRes.json() as { id: string }).id;

  const dbml = syntheticDbml(tableCount);
  const importSamples: number[] = [];
  const fetchSamples: number[] = [];
  const exportSamples: number[] = [];

  // First import seeds the schema; later ones exercise `mergeProjectIntoExisting`
  // against an already-large project — the reimport/live-resync path, not just
  // a cold parse into an empty one.
  const ROUNDS = 5;
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/import`,
      headers: headers({ cookie }),
      payload: { source: dbml },
    });
    importSamples.push(performance.now() - start);
  }

  for (let i = 0; i < ROUNDS; i++) {
    const start = performance.now();
    await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: headers({ cookie }) });
    fetchSamples.push(performance.now() - start);
  }

  for (let i = 0; i < ROUNDS; i++) {
    const start = performance.now();
    await app.inject({ method: "GET", url: `/api/projects/${projectId}/export/dbml`, headers: headers({ cookie }) });
    exportSamples.push(performance.now() - start);
  }

  closeRoom(projectId);
  return [
    { label: `import (${tableCount} tables)`, samples: importSamples },
    { label: `GET project (${tableCount} tables)`, samples: fetchSamples },
    { label: `export dbml (${tableCount} tables)`, samples: exportSamples },
  ];
}

/** Fake enough of a `ws` WebSocket for `Room.receive`/`join` — it only ever calls `.send`, `.readyState`, `.OPEN`, `.close`. */
function fakeSocket() {
  return { readyState: 1, OPEN: 1, send: () => {}, close: () => {} } as unknown as import("ws").WebSocket;
}

/** Drives the WebSocket room's message path directly: N small field-name edits, applied as real Yjs sync-protocol frames through `Room.receive` — the same code path a live drag/typing session hits, minus the network. */
function benchRoom(tableCount: number, editCount: number): Timing {
  // `appendRevision` foreign-keys `revisions.project_id` to a real `projects`
  // row — without one every write in this benchmark would silently fail
  // (caught and logged, not thrown) and understate the persisted cost.
  const ownerId = randomUUID();
  const projectId = `bench-room-${randomUUID()}`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, 'x', 0, 'bench')").run(
    ownerId,
    `${ownerId}@example.com`,
  );
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)").run(projectId, "bench-room", ownerId);

  const room = getRoom(projectId);
  const socket = fakeSocket();
  room.join(socket, "bench-user", () => ({ canWrite: true }));

  // Seed the doc with `tableCount` tables directly (bypassing import — this
  // benchmark is about the *edit* path, not the import path already covered above).
  const seedDoc = new Y.Doc();
  const tables = seedDoc.getMap<Record<string, unknown>>("tables");
  seedDoc.transact(() => {
    for (let i = 0; i < tableCount; i++) {
      tables.set(`t${i}`, {
        id: `t${i}`,
        name: `table_${i}`,
        position: { x: (i % 10) * 300, y: Math.floor(i / 10) * 300 },
        fields: [{ id: `t${i}f0`, name: "id", type: "integer", pk: true }],
        indexes: [],
      });
    }
  });
  const seedEncoder = encoding.createEncoder();
  encoding.writeVarUint(seedEncoder, 0);
  syncProtocol.writeUpdate(seedEncoder, Y.encodeStateAsUpdate(seedDoc));
  room.receive(socket, encoding.toUint8Array(seedEncoder));
  resetPerfReport();

  const samples: number[] = [];
  for (let i = 0; i < editCount; i++) {
    const editDoc = new Y.Doc();
    Y.applyUpdate(editDoc, Y.encodeStateAsUpdate(seedDoc));
    const t = editDoc.getMap<Record<string, unknown>>("tables");
    const key = `t${i % tableCount}`;
    const current = t.get(key);
    editDoc.transact(() => t.set(key, { ...current, name: `table_${i % tableCount}_edit${i}` }));

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(editDoc, Y.encodeStateVector(seedDoc)));

    const start = performance.now();
    room.receive(socket, encoding.toUint8Array(encoder));
    samples.push(performance.now() - start);
  }

  closeRoom(projectId);
  return { label: `room.receive (${tableCount} tables, ${editCount} edits)`, samples };
}

async function main() {
  const { values } = parseArgs({
    options: { tables: { type: "string" }, edits: { type: "string" } },
  });
  const sizes = values.tables ? [Number(values.tables)] : [10, 100, 500];
  const editCount = values.edits ? Number(values.edits) : 300;

  const app = await buildApp();
  await app.ready();

  console.log("\n=== REST: import / fetch / export, across schema size ===");
  const restTimings: Timing[] = [];
  for (const size of sizes) {
    restTimings.push(...(await benchRest(app, size)));
  }
  report(restTimings);

  console.log("\n=== WebSocket room: field-edit throughput, across schema size ===");
  const roomTimings: Timing[] = [];
  for (const size of sizes) {
    roomTimings.push(benchRoom(size, editCount));
  }
  report(roomTimings);

  console.log("\n=== Server-side perf counters accumulated during this run (see infrastructure/perf.ts) ===");
  console.table(getPerfReport());

  await app.close();
  db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
