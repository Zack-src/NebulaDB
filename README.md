# NebulaDB

Self-hosted DBML schema editor with real-time collaboration, history, and a workbench for the databases it models. Your data stays on your server.

## Run it

Node 22–25 required.

```bash
npm install
npm run bootstrap-admin -- you@example.com 'a-strong-password'   # first admin, once
npm run dev                                                       # server :3001 + web :5173
```

Production (one process, one port; the server also serves the web app):

```bash
npm run build
npm start                                                         # http://localhost:3001
```

Docker (data in the `nebuladb-data` volume):

```bash
docker compose up --build
```

Other accounts are created by invitation from the admin console.

## Configuration

Environment variables, or `apps/server/.env` (see [`.env.example`](apps/server/.env.example)). Invalid values stop the server at boot with a `[config]` message.

| Variable                                                                     | Default                  | What it does                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                       | `3001`                   | HTTP and WebSocket port.                                                                                    |
| `NEBULADB_DB_PATH`                                                           | `./data/nebuladb.sqlite` | SQLite file for all app data.                                                                               |
| `NEBULADB_SECRET`                                                            | —                        | Encrypts stored database credentials and 2FA secrets. Required before using either. `openssl rand -hex 32`. |
| `NEBULADB_SECRET_PREVIOUS`                                                   | —                        | Old secret, only while rotating (`npm run rotate-secret`).                                                  |
| `NEBULADB_COOKIE_SECURE`                                                     | `false`                  | Set `true` behind TLS.                                                                                      |
| `NEBULADB_ALLOWED_ORIGINS`                                                   | —                        | Extra allowed origins, comma-separated.                                                                     |
| `NEBULADB_PUBLIC_URL`                                                        | —                        | Public URL, used in emails. Required with SMTP.                                                             |
| `NEBULADB_SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` / `_FROM` | — / `587`                | Email for invitations and password reset. Off when no host.                                                 |
| `NEBULADB_LOG_LEVEL`                                                         | `info`                   | `fatal` … `trace`, `silent`.                                                                                |
| `NEBULADB_MAX_BODY_MB`                                                       | `4`                      | Max request body.                                                                                           |
| `NEBULADB_MAX_WS_FRAME_MB`                                                   | `8`                      | Max WebSocket frame.                                                                                        |
| `NEBULADB_BACKUP_INTERVAL_HOURS`                                             | `0` (off)                | Automatic backups of every project.                                                                         |
| `NEBULADB_BACKUP_DIR`                                                        | `./backups`              | Where they go.                                                                                              |
| `NEBULADB_BACKUP_KEEP`                                                       | `7`                      | How many to keep.                                                                                           |
| `NEBULADB_DATABASE_BACKUP_DIR`                                               | next to the app database | Backups of connected databases.                                                                             |
| `NEBULADB_DATABASE_BACKUP_MAX_MB`                                            | `512`                    | Max data read by one backup.                                                                                |
| `NEBULADB_DATABASE_BACKUP_RETENTION_DAYS`                                    | `30`                     | Days kept; `0` = forever.                                                                                   |
| `NEBULADB_AUDIT_RETENTION_DAYS`                                              | `365`                    | Audit log retention; `0` = forever.                                                                         |
| `NEBULADB_QUERY_STATS_RETENTION_DAYS`                                        | `30`                     | SQL console statistics retention.                                                                           |
| `NEBULADB_DB_ACTIVITY_RETENTION_DAYS`                                        | `14`                     | Database activity history retention.                                                                        |
| `NEBULADB_CONNECTION_HEALTH_INTERVAL_MINUTES`                                | `15`                     | Connection health checks; `0` = off.                                                                        |
| `NEBULADB_SQLITE_DIR`                                                        | —                        | Restrict SQLite connections to this folder.                                                                 |

## Features

| Area            | What you get                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Editing         | DBML text and visual canvas, synced both ways. Tables, zones, notes, enums, groups.                                       |
| Views           | Logical (tables), conceptual (Merise MCD), three detail levels per table, auto-layout.                                    |
| Collaboration   | Live cursors and edits (Yjs), comments with @mentions, undo/redo.                                                         |
| History         | Every change is a revision: timeline, labels, diff, non-destructive restore.                                              |
| Import / export | DBML and SQL (Postgres, MySQL, MSSQL); PNG, SVG, PDF.                                                                     |
| Live databases  | Connect PostgreSQL, MySQL/MariaDB, SQL Server, Oracle or SQLite; pull the schema, diff, deploy with preview and rollback. |
| SQL space       | Query console, data browser, journal, statistics, health, account watch.                                                  |
| Governance      | Table locks, structure policy, environments chain, deployment risk checks.                                                |
| Data            | Seeds from CSV or a database, test-data generator.                                                                        |
| Quality         | Schema linter with presets, validation panel.                                                                             |
| Access          | Invitations, teams, per-project roles, 2FA, API keys, [public API](docs/public-api.md), [webhooks](docs/webhooks.md).     |
| Extensibility   | Sandboxed browser plugins: exporters, importers, canvas and editor commands.                                              |
| Operations      | Backups, audit log, `/api/health`, `/api/metrics`, French and English UI.                                                 |

Docs: [feature status](docs/etat-des-features.md) · [roadmap](docs/todo.md) · [public API](docs/public-api.md) · [webhooks](docs/webhooks.md)

## Operations

**Single process.** State lives in SQLite and in-memory rooms: never run two instances on the same data.

**Reverse proxy.** Terminate TLS and set `NEBULADB_COOKIE_SECURE=true`, forward the WebSocket on `/ws/`, and keep the `Host` header (or set `NEBULADB_ALLOWED_ORIGINS`).

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
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

**Logs** are JSON on stdout; rotation is up to Docker (`docker-compose.yml` caps them) or your process manager.

**Upgrading from AthanorDB:** see [`docs/renommage-nebuladb.md`](docs/renommage-nebuladb.md).

## Develop

| Command                           | Does                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Server and web with hot reload.                   |
| `npm run build`                   | Build everything.                                 |
| `npm test` / `npm run test:e2e`   | Unit / browser tests.                             |
| `npm run lint` / `npm run format` | ESLint / Prettier.                                |
| `npm run bench:web -- --cpu 6`    | Canvas benchmark; results go to `bench-results/`. |

```
apps/server     Fastify + WebSocket server, SQLite, database drivers
apps/web        Svelte 5 app: canvas (Svelte Flow), DBML editor, SQL space, admin
packages/shared       Schema model, protocol, Yjs binding
packages/dbml-engine  DBML ⇄ SQL ⇄ model conversion, diff, validation, lint
```

Tests that talk to real databases skip themselves unless `docker compose -f docker-compose.test.yml up -d` is running.
