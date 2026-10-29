import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`, and
// importing that connects: it needs a database to connect to, even with nothing to store.
await useTestDatabase("pinningengines");

const { pinConnectionTarget } = await import("./targetPinning.js");

const base = { id: "c", projectId: "", name: "n" };
const forbidden = { code: "CONNECTION_TARGET_FORBIDDEN" };

test("ClickHouse, MongoDB and Redis hosts are resolved once and pinned, like any network engine", async () => {
  for (const engine of ["clickhouse", "mongodb", "redis"] as const) {
    const pinned = await pinConnectionTarget({ ...base, engine, host: "localhost" });
    assert.match(pinned.pinnedAddress ?? "", /^(127\.0\.0\.1|::1)$/, engine);
    assert.equal(pinned.tlsServerName, "localhost", engine);
    assert.equal(pinned.host, "localhost", `${engine}: the stored host is untouched`);
  }
});

test("the metadata endpoint is refused in the host field of the three engines", async () => {
  for (const engine of ["clickhouse", "mongodb", "redis"] as const) {
    await assert.rejects(pinConnectionTarget({ ...base, engine, host: "169.254.169.254" }), forbidden, engine);
  }
});

test("MongoDB: every host of a URI is checked, and none is rewritten", async () => {
  const kept = "mongodb://user:p%40ss@localhost:27017,127.0.0.1:27018/shop?replicaSet=rs0";
  const config: DatabaseConnectionConfig = { ...base, engine: "mongodb", connectionString: kept };
  assert.equal((await pinConnectionTarget(config)).connectionString, kept);

  for (const connectionString of [
    "mongodb://u:p@169.254.169.254:27017/db",
    "mongodb://u:p@localhost:27017,169.254.169.254:27017/db",
    "mongodb://u:p@metadata.google.internal/db",
  ]) {
    await assert.rejects(
      pinConnectionTarget({ ...base, engine: "mongodb", connectionString }),
      forbidden,
      connectionString,
    );
  }
});

test("MongoDB: a mongodb+srv URI is refused, its hosts being looked up after the check", async () => {
  await assert.rejects(
    pinConnectionTarget({ ...base, engine: "mongodb", connectionString: "mongodb+srv://u:p@cluster.example.com/db" }),
    forbidden,
  );
});

test("ClickHouse and Redis URIs: the host is checked, the URI is left as it is", async () => {
  const cases = [
    {
      engine: "clickhouse" as const,
      ok: "http://default:secret@localhost:8123/shop",
      bad: "http://169.254.169.254:8123/shop",
    },
    { engine: "redis" as const, ok: "redis://:secret@localhost:6379/0", bad: "redis://:secret@169.254.169.254:6379/0" },
  ];
  for (const { engine, ok, bad } of cases) {
    assert.equal((await pinConnectionTarget({ ...base, engine, connectionString: ok })).connectionString, ok, engine);
    await assert.rejects(pinConnectionTarget({ ...base, engine, connectionString: bad }), forbidden, engine);
  }
});
