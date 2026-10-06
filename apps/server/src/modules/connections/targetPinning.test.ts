import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.NEBULADB_DB_PATH ??= join(tmpdir(), `nebuladb-test-pinning-${randomUUID()}.sqlite`);

const { pinConnectionTarget } = await import("./targetPinning.js");

const base = { id: "c", projectId: "", name: "n" };

test("a host given as a name is resolved once and the driver is handed that address, keeping the name for TLS", async () => {
  const pinned = await pinConnectionTarget({ ...base, engine: "postgres", host: "localhost", port: 5432 });
  assert.match(pinned.pinnedAddress ?? "", /^(127\.0\.0\.1|::1)$/);
  assert.equal(pinned.tlsServerName, "localhost");
  assert.equal(pinned.host, "localhost", "the stored host is untouched");
});

test("a literal IP is used as is, with no TLS server name", async () => {
  const pinned = await pinConnectionTarget({ ...base, engine: "mysql", host: "127.0.0.1" });
  assert.equal(pinned.pinnedAddress, "127.0.0.1");
  assert.equal(pinned.tlsServerName, undefined);
});

test("the metadata endpoint is refused wherever it hides: host field, URL, SQL Server string, Oracle string", async () => {
  const forbidden = { code: "CONNECTION_TARGET_FORBIDDEN" };
  const cases: DatabaseConnectionConfig[] = [
    { ...base, engine: "postgres", host: "169.254.169.254" },
    { ...base, engine: "postgres", connectionString: "postgres://u:p@169.254.169.254:5432/db" },
    { ...base, engine: "mysql", connectionString: "mysql://u:p@metadata.google.internal/db" },
    { ...base, engine: "mssql", connectionString: "Server=tcp:169.254.169.254,1433;Database=x;User Id=sa;Password=p" },
    { ...base, engine: "oracle", connectionString: "169.254.169.254:1521/FREEPDB1" },
    {
      ...base,
      engine: "oracle",
      connectionString: "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=169.254.169.254)(PORT=1521)))",
    },
  ];
  for (const config of cases)
    await assert.rejects(pinConnectionTarget(config), forbidden, config.connectionString ?? config.host);
});

test("a Postgres URL is rewritten to the resolved address and its sslmode carried over as explicit TLS settings", async () => {
  const pinned = await pinConnectionTarget({
    ...base,
    engine: "postgres",
    connectionString: "postgres://user:secret@localhost:5432/app?sslmode=require&application_name=x",
  });
  const url = new URL(pinned.connectionString!);
  assert.match(url.hostname, /^(127\.0\.0\.1|\[::1\])$/);
  assert.equal(url.password, "secret");
  assert.equal(url.searchParams.get("sslmode"), null);
  assert.equal(url.searchParams.get("application_name"), "x");
  assert.equal(pinned.ssl, true);
  assert.equal(pinned.tlsVerify, true);
  assert.equal(pinned.tlsServerName, "localhost");
});

test("a URL carrying its own certificate files is checked but left untouched", async () => {
  const connectionString = "postgres://u:p@localhost/db?sslmode=verify-full&sslrootcert=/etc/ca.pem";
  const pinned = await pinConnectionTarget({ ...base, engine: "postgres", connectionString });
  assert.equal(pinned.connectionString, connectionString);
});

test("sqlite configs pass through", async () => {
  const config: DatabaseConnectionConfig = { ...base, engine: "sqlite", filePath: "/tmp/x.sqlite" };
  assert.equal(await pinConnectionTarget(config), config);
});
