# NebulaDB

Self-hosted DBML schema editor with real-time collaboration, history, and a workbench for the databases it models. Your data stays on your server.

## Run it

Node 22–25 and a PostgreSQL database (13 or later) for NebulaDB's own data.

```bash
npm install
# apps/server/.env: NEBULADB_DATABASE_URL=postgres://nebuladb:password@localhost:5432/nebuladb
npm run bootstrap-admin -- you@example.com 'a-strong-password'   # first admin, once
npm run dev                                                       # server :3001 + web :5173
```

Production (one process, one port; the server also serves the web app):

```bash
npm run build
npm start                                                         # http://localhost:3001
```

Docker (with its own PostgreSQL; data in the `nebuladb-postgres` and `nebuladb-data` volumes — set `NEBULADB_POSTGRES_PASSWORD` first, letters and digits only since it goes into a URL):

```bash
docker compose up --build
```

Other accounts are created by invitation from the admin console.

## Configuration

Environment variables, or `apps/server/.env` (see [`.env.example`](apps/server/.env.example)). Invalid values stop the server at boot with a `[config]` message.

| Variable                                                                     | Default                   | What it does                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                       | `3001`                    | HTTP and WebSocket port.                                                                                    |
| `NEBULADB_DATABASE_URL`                                                      | — (required)              | PostgreSQL database for all app data, `postgres://user:password@host:5432/db`. Tables are created at boot.  |
| `NEBULADB_DATABASE_POOL_SIZE`                                                | `10`                      | Most connections the server opens to it.                                                                    |
| `NEBULADB_SECRET`                                                            | —                         | Encrypts stored database credentials and 2FA secrets. Required before using either. `openssl rand -hex 32`. |
| `NEBULADB_SECRET_PREVIOUS`                                                   | —                         | Old secret, only while rotating (`npm run rotate-secret`).                                                  |
| `NEBULADB_COOKIE_SECURE`                                                     | `false`                   | Set `true` behind TLS.                                                                                      |
| `NEBULADB_ALLOWED_ORIGINS`                                                   | —                         | Extra allowed origins (API writes, WebSocket), comma-separated.                                             |
| `NEBULADB_TRUST_PROXY`                                                       | `false`                   | Behind a reverse proxy: `1` (hops), or its IPs/CIDRs. Client IP then comes from `X-Forwarded-For`.          |
| `NEBULADB_PUBLIC_URL`                                                        | —                         | Public URL, used in emails. Required with SMTP.                                                             |
| `NEBULADB_SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` / `_FROM` | — / `587`                 | Email for invitations and password reset. Off when no host.                                                 |
| `NEBULADB_LOG_LEVEL`                                                         | `info`                    | `fatal` … `trace`, `silent`.                                                                                |
| `NEBULADB_MAX_BODY_MB`                                                       | `4`                       | Max request body.                                                                                           |
| `NEBULADB_MAX_WS_FRAME_MB`                                                   | `8`                       | Max WebSocket frame.                                                                                        |
| `NEBULADB_BACKUP_INTERVAL_HOURS`                                             | `0` (off)                 | Automatic backups of every project.                                                                         |
| `NEBULADB_BACKUP_DIR`                                                        | `./backups`               | Where they go.                                                                                              |
| `NEBULADB_BACKUP_KEEP`                                                       | `7`                       | How many to keep.                                                                                           |
| `NEBULADB_DATABASE_BACKUP_DIR`                                               | `./data/database-backups` | Backups of connected databases.                                                                             |
| `NEBULADB_DATABASE_BACKUP_MAX_MB`                                            | `512`                     | Max data read by one backup.                                                                                |
| `NEBULADB_DATABASE_BACKUP_RETENTION_DAYS`                                    | `30`                      | Days kept; `0` = forever.                                                                                   |
| `NEBULADB_AUDIT_RETENTION_DAYS`                                              | `365`                     | Audit log retention; `0` = forever.                                                                         |
| `NEBULADB_QUERY_STATS_RETENTION_DAYS`                                        | `30`                      | SQL console statistics retention.                                                                           |
| `NEBULADB_DB_ACTIVITY_RETENTION_DAYS`                                        | `14`                      | Database activity history retention.                                                                        |
| `NEBULADB_SEED_DIR`                                                          | `./data/seeds`            | Where initial data too big for the database is kept (one CSV per table).                                    |
| `NEBULADB_SEED_FILE_MAX_GB`                                                  | `20`                      | Largest seed file, in GB.                                                                                   |
| `NEBULADB_SEED_MAX_KEYS`                                                     | `5000000`                 | Key values a big seed's checks may keep in memory.                                                          |
| `NEBULADB_SEED_IMPORT_DIR`                                                   | — (off)                   | Folder administrators may import seed files from by path.                                                   |
| `NEBULADB_CONNECTION_HEALTH_INTERVAL_MINUTES`                                | `15`                      | Connection health checks; `0` = off.                                                                        |
| `NEBULADB_SQLITE_DIR`                                                        | —                         | Restrict SQLite connections to this folder.                                                                 |
| `NEBULADB_WEBHOOK_BLOCK_PRIVATE`                                             | `1` (on)                  | Webhooks to loopback, private, link-local and reserved addresses are refused; `0` allows them.              |
| `NEBULADB_WEBHOOK_ALLOWED_HOSTS`                                             | —                         | Comma-separated hosts (`a.com`, `*.a.com`, IP, CIDR) webhooks are limited to; exempt from the above.        |

## Features

| Area            | What you get                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editing         | DBML text and visual canvas, synced both ways. Tables, zones, notes, enums, groups.                                                                                        |
| Views           | Logical (tables), conceptual (Merise MCD), three detail levels per table, auto-layout.                                                                                     |
| Collaboration   | Live cursors and edits (Yjs), comments with @mentions, undo/redo, read-only share links, per-client variants, folders.                                                     |
| History         | Every change is a revision: timeline, labels, diff, non-destructive restore.                                                                                               |
| Import / export | Import DBML, bundle, SQL (Postgres, MySQL, MSSQL, SQLite), JSON Schema. Export DBML, bundle, SQL, TypeScript, Prisma, Mermaid, PNG, SVG, PDF, Flyway/Liquibase migrations. |
| Live databases  | Connect PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, BigQuery or SQLite; pull the schema, diff, deploy with preview and rollback.                                        |
| SQL space       | Query console, data browser, journal, statistics, health, account watch.                                                                                                   |
| Governance      | Table locks, structure policy, environments chain, deployment reviews and risk checks.                                                                                     |
| Data            | Seeds from CSV or a database, test-data generator.                                                                                                                         |
| Quality         | Schema linter with presets, validation panel.                                                                                                                              |
| Access          | Invitations, teams, per-project roles, 2FA, OpenID Connect SSO, API keys, [public API](docs/public-api.md), [webhooks](docs/webhooks.md).                                  |
| Extensibility   | Sandboxed browser plugins: exporters, importers, canvas and editor commands.                                                                                               |
| Operations      | Backups, audit log, `/api/health`, `/api/metrics`, French and English UI.                                                                                                  |

Docs: [feature status](docs/etat-des-features.md) · [roadmap](docs/todo.md) · [public API](docs/public-api.md) · [webhooks](docs/webhooks.md)

## Operations

**Single process.** Data lives in PostgreSQL, but each open project's live document lives in the server's memory: never run two instances on the same database.

**Moving from SQLite.** Releases before PostgreSQL kept everything in one SQLite file (`./data/nebuladb.sqlite`, or `/data/nebuladb.sqlite` in Docker). Start the last SQLite release on it once so it is up to date, stop it, point `NEBULADB_DATABASE_URL` at a new, empty PostgreSQL database, then:

```bash
npm run migrate-from-sqlite -- ./data/nebuladb.sqlite
```

Every table is copied in one transaction; the tool refuses a file at another schema version and a database that already holds data. The SQLite file is only read: keep it as a backup.

**Reverse proxy.** Terminate TLS and set `NEBULADB_COOKIE_SECURE=true`, forward the WebSocket on `/ws/`, and keep the `Host` header (or set `NEBULADB_ALLOWED_ORIGINS`). Pass the client address in `X-Forwarded-For` and set `NEBULADB_TRUST_PROXY=1` (or the proxy's address): otherwise every client shares the proxy's IP, and one script hitting the login limit locks everyone out.

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

**Backup / restore.**

```bash
npm run backup [-- <dir>]                       # every project to .dbml files
npm run restore -- <dir> [--owner <email>]      # each file becomes a new project
```

**Logs and retention.** What NebulaDB keeps, and for how long. Purges run at boot and then hourly.

| Log (table)                                     | Kept                                    | Setting                                   |
| ----------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| Audit (`audit_log`)                             | 365 days                                | `NEBULADB_AUDIT_RETENTION_DAYS`           |
| SQL console statistics (`query_stats`)          | 30 days                                 | `NEBULADB_QUERY_STATS_RETENTION_DAYS`     |
| Database activity (`db_activity`)               | 14 days                                 | `NEBULADB_DB_ACTIVITY_RETENTION_DAYS`     |
| Backups of connected databases (`backups`)      | 30 days, pinned ones kept               | `NEBULADB_DATABASE_BACKUP_RETENTION_DAYS` |
| Project backups (`npm run backup`, scheduled)   | the last 7                              | `NEBULADB_BACKUP_KEEP`                    |
| Webhook deliveries (`webhook_deliveries`)       | 30 days                                 | fixed                                     |
| Server errors (`error_log`)                     | the last 2,000                          | fixed                                     |
| Connection health samples (`db_health_samples`) | 7 days                                  | fixed                                     |
| SQL console history (`admin_query_history`)     | the last 200 entries                    | fixed                                     |
| Notifications (`notifications`)                 | the last 200 per user                   | fixed                                     |
| Drift events (`drift_events`)                   | never purged (removed with the project) | none                                      |
| Deployment history (`deployment_history`)       | never purged (removed with the project) | none                                      |
| Application logs (pino, stdout)                 | not stored by NebulaDB                  | see below                                 |

`0` means keep everything where a setting accepts it.

**Log rotation.** The application logs are JSON on stdout and NebulaDB does not rotate them: the host does. In Docker, `docker-compose.yml` caps them with the `json-file` driver (`max-size: "10m"`, `max-file: "5"`); on another setup use `docker logs --log-opt max-size=…` when you `docker run`, journald (`SystemMaxUse=`, `journalctl --vacuum-time=30d`) or your process manager's own rotation.

**Upgrading from AthanorDB:** the old `ATHANORDB_*` variables are still read when the `NEBULADB_*` one is not set; rename them when convenient.

## Develop

| Command                           | Does                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Server and web with hot reload.                   |
| `npm run build`                   | Build everything.                                 |
| `npm test` / `npm run test:e2e`   | Unit / browser tests.                             |
| `npm run lint` / `npm run format` | ESLint / Prettier.                                |
| `npm run bench:web -- --cpu 6`    | Canvas benchmark; results go to `bench-results/`. |

```
apps/server     Fastify + WebSocket server, PostgreSQL storage, database drivers
apps/web        Svelte 5 app: canvas (Svelte Flow), DBML editor, SQL space, admin
packages/shared       Schema model, protocol, Yjs binding
packages/dbml-engine  DBML ⇄ SQL ⇄ model conversion, diff, validation, lint
```

The server tests need the throwaway PostgreSQL of `docker-compose.test.yml` (each test file gets a database of its own on it, dropped afterwards):

```bash
docker compose -f docker-compose.test.yml up -d nebuladb-test-postgres
npm run build -w apps/server && npm test -w apps/server
```

`NEBULADB_TEST_PG_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` point them elsewhere. Tests of the other engines (MySQL, SQL Server, Oracle) skip themselves unless their containers run (`docker compose -f docker-compose.test.yml up -d`).
