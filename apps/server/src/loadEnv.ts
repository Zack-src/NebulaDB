import { fileURLToPath } from "node:url";

/**
 * Loads `.env` files into `process.env` before anything else. Must stay the *first* import in
 * `index.ts` so `config.ts` sees the values. Uses `process.loadEnvFile`, no `dotenv`.
 *
 * Read in this order, a value already set always winning (real environment > apps/server/.env
 * > repository-root .env):
 * - `apps/server/.env`: optional, server-only overrides;
 * - the root `.env`: the one file a local setup needs, shared with `docker compose`.
 *
 * Without `NEBULADB_DATABASE_URL`, the URL of the PostgreSQL started by `npm run db:up` is
 * derived from `NEBULADB_POSTGRES_PASSWORD` and `NEBULADB_POSTGRES_PORT` (default 5433).
 * Paths are relative to this file (src/ or dist/), so the working directory doesn't matter.
 */
for (const file of ["../.env", "../../../.env"]) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(file, import.meta.url)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

const devPassword = process.env.NEBULADB_POSTGRES_PASSWORD?.trim();
if (!process.env.NEBULADB_DATABASE_URL?.trim() && devPassword) {
  const port = process.env.NEBULADB_POSTGRES_PORT?.trim() || "5433";
  process.env.NEBULADB_DATABASE_URL = `postgres://nebuladb:${encodeURIComponent(devPassword)}@localhost:${port}/nebuladb`;
}
