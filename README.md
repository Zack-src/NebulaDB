# AthanorDB

Self-hosted, DBML-native database schema diagramming — think dbdiagram.io, but running entirely on your own machine or LAN, with real-time multi-user editing and full history built in.

Your data stays on your server; nothing is sent anywhere else. Note that this is _not_ local-first in the technical sense: state lives on the server, and the browser needs a connection to it. An open tab survives a network blip and resyncs on reconnect (see the reconnect logic in `yjsClient.ts`), but there is no offline persistence — closing the tab mid-outage loses unsynced edits.

## Features

- **DBML-native**: the schema's source of truth is DBML text. A live Monaco editor panel sits next to the canvas and syncs both ways — edit the diagram visually, or edit the DBML directly, changes apply to the other side automatically (~600ms debounce).
- **Visual canvas editor** (React Flow): drag tables/zones/sticky notes around, resize zones and notes, pan/zoom, minimap. No "Add Table" toolbar button — right-click empty canvas to add a table, zone, or sticky note.
- **Detail levels per table**: `compact` (key fields only), `standard` (PK/FK), `full` (every field) — switch one table or all of them at once.
- **Auto-layout**: one-click layout of the whole diagram (dagre), following FK direction.
- **Styling**: color picker (preset swatches + custom hex) for table headers, zones, and sticky notes.
- **Comments**: attach threaded comments to a table or a specific field.
- **Real-time collaboration**: multiple people can open the same project at once (Yjs CRDT sync over WebSocket) — live cursors, colored presence list, no lock-step required.
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z) and **duplicate** (Ctrl+D) for canvas edits.
- **Manual reference routing**: double-click a ref line to add a waypoint and route it around tables; lines animate in the direction of cardinality (both directions for many-to-many).
- **Import**: DBML or raw SQL DDL (Postgres/MySQL/MSSQL), via paste or file upload. Re-importing merges by name, so existing positions/styling/detail levels are preserved rather than reset.
- **Export**: DBML, SQL (Postgres/MySQL/MSSQL), or a canvas snapshot as PNG/SVG/PDF.
- **Plugins**: add your own export dialects, import parsers, canvas commands and DBML-editor commands without touching the app. Plugin code runs in a sandboxed Web Worker — see [Plugins](#plugins).
- **Validation panel**: flags circular references, missing FK targets, and duplicate table/field names (informational — never blocks editing).
- **History**: every change is a revision. Browse the timeline, label checkpoints (e.g. `v1.0`), preview a past revision's DBML, see a schema-level diff against the current state, and restore non-destructively (restoring creates a new revision, it never rewrites history).
- **Per-user preferences**: canvas text size and last pan/zoom position are remembered per person, not shared.
- **Backup & restore scripts**: dump every project to a `.dbml` file on disk (`npm run backup`), and bulk-import a backup directory back in as new projects (`npm run restore`).
- **Dark theme**, single unified header, no cloud dependency — everything (fonts, editor, icons) is bundled, nothing loads from a CDN.

## Stack

| Layer               | Choice                                                     | Why                                                                                 |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Monorepo            | npm workspaces                                             | no extra global tool                                                                |
| Frontend            | React + TypeScript + Vite                                  | fast dev loop, huge ecosystem                                                       |
| Canvas              | React Flow (`@xyflow/react`)                               | node/edge graph primitive, zoom/pan/minimap, custom node renderers per detail level |
| DBML editor         | Monaco (`@monaco-editor/react`), self-hosted               | same editor as VS Code; self-hosted worker/assets, no CDN                           |
| Auto-layout         | `@dagrejs/dagre`                                           | directed-graph layout, used to lay tables out by FK direction                       |
| Canvas export       | `html-to-image` + `jsPDF`                                  | PNG/SVG snapshot of the canvas, wrapped into a PDF                                  |
| Backend             | Node + TypeScript + Fastify                                | lightweight server, native WS plugin                                                |
| Realtime collab     | Yjs CRDT, hand-rolled WS protocol (`y-protocols` + `lib0`) | multi-user editing and undo/history almost for free, no `y-websocket` dependency    |
| Persistence         | SQLite (`better-sqlite3`)                                  | zero-config, single file, fits a single-server self-hosted deploy                   |
| DBML parse/gen      | `@dbml/core`                                               | official parser, handles DBML <-> SQL (Postgres/MySQL/MSSQL) both ways              |
| Diagram state model | custom schema layered on the Yjs doc                       | tables/fields/refs/notes/zones + visual metadata (position, color, detail level)    |
| Packaging           | plain Node process, optional Docker                        | `npm run dev` or `docker compose up`, no cloud dependency                           |

## Running

Requires Node 20-23 (`.nvmrc`/`.node-version` pin 22). **Node 24 is not supported yet**: the server's SQLite driver (`better-sqlite3`) is a native addon and has no precompiled binary for Node 24 on any platform as of this writing, so `npm install` will fail to produce a working build unless you have C++ build tools (Visual Studio Build Tools + Python) installed to compile it from source. If you're on a locked-down corporate machine without those, install Node 22 instead — no admin rights needed:

1. Download the "Windows Binary (.zip)" for Node 22 LTS from [nodejs.org](https://nodejs.org/en/download).
2. Unzip it anywhere in your user profile (e.g. `C:\Users\<you>\node22`).
3. Point your shell at it for this project, e.g. in PowerShell: `$env:PATH = "C:\Users\<you>\node22;$env:PATH"` (do this once per terminal session, or add it to your PowerShell profile).
4. Confirm with `node -v` (should print `v22.x`), then proceed below as normal.

```bash
npm install
npm run dev          # server (:3001) + web (:5173) together, with hot reload
```

Production (single process, single port — the server serves the built web app itself):

```bash
npm run build
npm start             # http://localhost:3001
```

### Configuration

Every value is validated at startup — a malformed one exits immediately with a `[config]` message rather than silently falling back.

| Variable                          | Default                   | Purpose                                                                                                                                                                                    |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ATHANORDB_DB_PATH`               | `./data/athanordb.sqlite` | SQLite file. Its directory is created if missing.                                                                                                                                          |
| `PORT`                            | `3001`                    | HTTP/WS port.                                                                                                                                                                              |
| `ATHANORDB_COOKIE_SECURE`         | unset (= `false`)         | Marks the session cookie `Secure`. **Set to `true` when running behind TLS** — with `NODE_ENV=production` and this unset, the server warns loudly at boot.                                 |
| `ATHANORDB_ALLOWED_ORIGINS`       | unset                     | Comma-separated extra origins allowed to make state-changing requests. The app's own host is always allowed; this is only needed if the UI is served from a different origin than the API. |
| `ATHANORDB_MAX_BODY_MB`           | `4`                       | Max REST request body (DBML/SQL imports are the large ones).                                                                                                                               |
| `ATHANORDB_MAX_WS_FRAME_MB`       | `8`                       | Max size of a single WebSocket frame (one Yjs update).                                                                                                                                     |
| `ATHANORDB_LOG_LEVEL`             | `info`                    | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. Session cookies and `Authorization` headers are redacted from logs at every level.                                    |
| `ATHANORDB_BACKUP_INTERVAL_HOURS` | `0` (off)                 | Hours between automatic backups. Off by default so an operator with their own volume-snapshot strategy doesn't get a second, unasked-for one.                                              |
| `ATHANORDB_BACKUP_DIR`            | `./backups`               | Where scheduled backups are written, one timestamped directory per run.                                                                                                                    |
| `ATHANORDB_BACKUP_KEEP`           | `7`                       | How many backup directories to keep. Older ones are pruned after each run — unbounded backups fill the disk the database lives on.                                                         |
| `ATHANORDB_AUDIT_RETENTION_DAYS`  | `365`                     | How long audit entries are kept before the hourly sweep deletes them. `0` keeps them indefinitely. If you change this, update your privacy policy to match.                                |

`SIGTERM`/`SIGINT` shut down gracefully: connections stop, every live document is snapshotted to SQLite, then the database is closed — so `docker stop` doesn't drop the last few seconds of edits.

If you run an instance other people use, you are the service operator and the data controller — see [`docs/legal/`](docs/legal/README.md) for terms-of-service and privacy-policy templates written against what this software actually stores and for how long.

None of these are secrets — there is no API key, no signing key, and no external service credential anywhere in the configuration, so plain environment variables are adequate and no secret-management integration is needed today. That changes the moment a live database connection is stored (see `docs/v1-roadmap.md` §7): connection strings must be encrypted at rest, and that work brings its own key-management decision with it.

### Docker

```bash
docker compose up --build
```

Serves on `:3001`, with project data persisted in a named volume (`athanordb-data`) rather than the container's own filesystem.

> **One process per database.** State lives in SQLite plus in-memory collaboration rooms held by the server process. Running two containers against the same volume will corrupt data — this does not scale horizontally by adding replicas. Scale up (a bigger box), not out.

### Running behind a reverse proxy

The single-process deployment serves the API, the WebSocket and the built web app on one port, so a proxy needs to do three things:

1. **Terminate TLS and set `ATHANORDB_COOKIE_SECURE=true`.** Sessions are cookie-based; without this the cookie is not marked `Secure`.
2. **Forward the WebSocket upgrade** on `/ws/`. A proxy that drops `Upgrade`/`Connection` headers leaves the app loading normally and then silently never syncing — the client will show `reconnecting…` forever.
3. **Preserve `Host`, or set `ATHANORDB_ALLOWED_ORIGINS`.** State-changing requests are rejected when the browser's `Origin` doesn't match the request's `Host` (a CSRF defence). A proxy that rewrites `Host` to its upstream target breaks every login until the browser-facing origin is listed explicitly.

nginx, for example:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;              # keeps the Origin check happy
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;                   # required for the WS upgrade
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;                 # idle editing sessions hold the socket open
}
```

### Backup

Dump every project to a `.dbml` file (defaults to `./backups/<timestamp>/`):

```bash
npm run backup [-- <outputDir>]
```

Each project is replayed from its revision log rather than read from the periodic snapshot, so a backup taken mid-edit contains that edit.

To have the server do this on a schedule instead, set `ATHANORDB_BACKUP_INTERVAL_HOURS` (see the configuration table). Runs are written to `ATHANORDB_BACKUP_DIR`, one timestamped directory each, and older ones beyond `ATHANORDB_BACKUP_KEEP` are pruned. Directories that don't look like a backup timestamp are never touched, so the folder is safe to share with your own files. Nothing runs at boot — a crash-looping container would otherwise produce a backup per restart and prune away the good ones.

The backup → restore round trip (schema, primary keys and canvas positions) is covered by `backupRunner.test.ts`, so it is exercised on every CI run rather than only when someone tries it in an emergency.

### Restore

Bulk-import a directory of `.dbml` files (as produced by `npm run backup` above) back in. Each file becomes a **new** project — this never overwrites an existing one, so restoring the same backup twice creates duplicates rather than risking data loss:

```bash
npm run restore -- <backupDir> [--owner <email>]
```

Without `--owner`, restored projects have no owner: any logged-in user can view them (the same default an ownerless project always gets), but only a global admin can manage or delete them — there's no "reassign owner" route yet to fix that up afterward. Pass `--owner` with an existing user's email to make that user the owner immediately.

### First admin account

Every account besides the first is created by accepting an admin-issued invitation, so bootstrap the first global admin directly:

```bash
npm run bootstrap-admin -- <email> <password>
```

Password must be 8–128 characters. Respects `ATHANORDB_DB_PATH` same as the server. Fails if that email already exists — run once, then invite everyone else from the admin console.

### Accounts, teams and invitations

- **Login** is email + password, with a server-side session cookie (`httpOnly`, `SameSite=Lax`, 30-day rolling expiry). Passwords are scrypt-hashed; login is rate limited to 10 attempts/minute per IP.
- **Invitations** are the only way to create further accounts: an admin issues one from the admin console and gets back an `/invite/<token>` URL, valid 7 days. **There is no email delivery** — the admin relays that link themselves, so treat it as a live credential and send it over a channel you trust.
- **Teams** scope project visibility. A project with no team assigned is visible to everyone; assigning a team restricts it to that team's members plus the creator and admins, at `view` / `edit` / `administrator` level.
- **Admins** manage users, teams and invitations, and can reset any password (which also kills that user's sessions).

## Plugins

The **Plugins** button in the project header opens the manager: install, enable/disable, remove, and read a plugin's console output. A one-click example plugin (a SQLite DDL exporter plus two commands) is included to copy from.

**How it works.** Every export format, import format and command in the app is a _contribution_, and the built-in DBML/SQL formats are themselves plugins (`athanordb.core-export`, `athanordb.core-import`, `athanordb.core-canvas`) — so a plugin that adds SQLite sits next to Postgres with no special casing. Four kinds are supported:

| Contribution            | Input                               | Returns                 | Appears in                         |
| ----------------------- | ----------------------------------- | ----------------------- | ---------------------------------- |
| `registerExporter`      | the `Project`                       | text (+ file extension) | Export dialog                      |
| `registerImporter`      | the pasted/uploaded text            | DBML source             | Import dialog                      |
| `registerCanvasCommand` | the `Project`                       | the modified `Project`  | Canvas toolbar → plugin menu       |
| `registerEditorCommand` | `{ text, selection, selectedText }` | the replacement buffer  | DBML editor palette (Ctrl+Shift+P) |

Every `run` also receives a second argument: `{ settings, selection: { tableIds } }` — the plugin's own configured settings, and which tables are selected on the canvas.

```js
athanor.plugin({
  id: "me.json-export",
  name: "JSON export",
  version: "1.0.0",
  settings: [{ key: "pretty", label: "Pretty-print", type: "boolean", default: true }],
});

athanor.registerExporter({
  id: "json",
  label: "JSON",
  extension: "json",
  run: function (project, context) {
    return JSON.stringify(project, null, context.settings.pretty ? 2 : 0);
  },
});

athanor.registerCanvasCommand({
  id: "drop-notes",
  label: "Clear notes on selected tables",
  shortcut: "Ctrl+Alt+N",
  run: function (project, context) {
    var selected = context.selection.tableIds;
    return Object.assign({}, project, {
      tables: project.tables.map(function (t) {
        return selected.indexOf(t.id) === -1 ? t : Object.assign({}, t, { note: undefined });
      }),
    });
  },
});
```

**Settings** are declared as data (`string` / `number` / `boolean` / `select`) and rendered by the app — a plugin never draws its own UI. Values are stored per plugin and passed to every call. **Shortcuts** are optional per command: canvas commands bind globally (never while typing), DBML-editor commands bind only while the editor has focus, and the first plugin to claim a combination keeps it. A user plugin's source can be downloaded again from the manager.

An importer returns DBML because the server's existing merge-by-name import route then applies it — your plugin only has to understand its own input format. A canvas command returns the whole project; the app diffs it into the Yjs document, so the change syncs to everyone with the project open, and only the entities that really changed produce an update.

**Security and scope.**

- Plugin code runs in a Web Worker built from a Blob URL: no DOM, no React state, no access to the page's memory. The worker's `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB` and `caches` are removed before the plugin body runs, so a plugin cannot call the API as you or send your schema anywhere.
- Loading is bounded (5s) and every call is bounded (10s); a plugin that hangs is terminated and restarted on the next call rather than freezing the app.
- This is isolation, not a trust boundary against a determined author: **only install plugin code you trust.**
- Plugins are stored in **your browser's** `localStorage` only. Nothing is uploaded, and nothing is shared with your team or other users of the same server — installing one is a decision that affects only you.

## Repo layout

```
apps/
  web/      React app (canvas editor, DBML/SQL panels)
    src/plugins/   plugin registry, Worker sandbox host, built-in plugins, example plugin
  server/   Fastify + WS server, SQLite storage, Yjs doc host
packages/
  dbml-engine/  DBML <-> SQL <-> internal-model conversion, diff, validation
  shared/       shared TS types (schema model, DTOs, protocol messages), Yjs doc <-> Project binding, input length limits
docs/
  todo.md       full project plan and progress log
```

## Status

Actively developed. See `docs/todo.md` for the full plan, current progress, and known limitations.

CI (`.github/workflows/ci.yml`) runs lint, build and tests on every push to `main` and every pull request.

## License

MIT — see [LICENSE](LICENSE).
