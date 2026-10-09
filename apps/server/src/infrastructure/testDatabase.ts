import { after } from "node:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

/**
 * A PostgreSQL database of its own for the test file that calls this, so
 * files — which `node --test` runs side by side — never see each other's rows.
 *
 * `db.ts` connects and migrates at import time, so this must be awaited before
 * anything that transitively imports it: a static `import` at the top of the
 * test file would already have run. Hence the pattern every such file starts
 * with:
 *
 *     await useTestDatabase("teams");
 *     const { buildApp } = await import("../../app.js");
 *
 * The server is the throwaway one from `docker-compose.test.yml`, the same the
 * PostgreSQL driver tests use, found through the same `NEBULADB_TEST_PG_*`
 * variables. The database is dropped once the file's tests are done.
 */
export async function useTestDatabase(label: string): Promise<string> {
  const env = process.env;
  const server = {
    host: env.NEBULADB_TEST_PG_HOST || "localhost",
    port: Number(env.NEBULADB_TEST_PG_PORT || 55432),
    user: env.NEBULADB_TEST_PG_USER || "nebuladb_test",
    password: env.NEBULADB_TEST_PG_PASSWORD || "nebuladb_test",
  };
  const maintenance = { ...server, database: env.NEBULADB_TEST_PG_DATABASE || "nebuladb_test" };
  const name = `nebuladb_test_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${randomUUID().slice(0, 8)}`;

  const admin = new pg.Client(maintenance);
  try {
    await admin.connect();
    // template0: nobody is ever connected to it, so files creating their
    // databases at the same moment do not trip over each other.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } catch (err) {
    throw new Error(
      `cannot create a test database on ${server.host}:${server.port} — start the test PostgreSQL with ` +
        "`docker compose -f docker-compose.test.yml up -d nebuladb-test-postgres` " +
        `(${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  } finally {
    await admin.end().catch(() => {});
  }

  const url = new URL("postgres://localhost");
  url.hostname = server.host;
  url.port = String(server.port);
  url.username = server.user;
  url.password = server.password;
  url.pathname = `/${name}`;
  env.NEBULADB_DATABASE_URL = url.href;
  // Backups of connected databases default to `./data`, under the working
  // directory: a test run must not leave files in the repository.
  env.NEBULADB_DATABASE_BACKUP_DIR ??= join(tmpdir(), name, "database-backups");

  after(async () => {
    const { db } = await import("./db.js");
    await db.close();
    const cleanup = new pg.Client(maintenance);
    try {
      await cleanup.connect();
      // FORCE: a connection a test left open must not keep the database alive.
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.end().catch(() => {});
    }
  });
  return url.href;
}
