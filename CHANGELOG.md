# Changelog

Notable changes to AthanorDB. The project is pre-1.0 and self-hosted: this file
exists so an operator upgrading an instance can tell, before pulling, whether a
release changes the database, the configuration, or anything they have to do by
hand.

Database migrations run automatically at boot (`apps/server/src/infrastructure/migrations.ts`,
tracked with `PRAGMA user_version`) and are one-way — take a backup before
upgrading (`npm run backup -- <dir>`).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

[Semantic Versioning](https://semver.org/), staying on `0.y.z` — every workspace
`package.json` shares one version number — until the "V1 checklist" in
[`docs/todo.md`](docs/todo.md) clears, at which point the next
release is tagged `1.0.0`. Chosen over calendar versioning: this project ships
when something is ready, not on a schedule, and `0.x` already signals
"pre-1.0, breaking changes possible between minors" without needing a second
convention layered on top. Releases are tagged (`vX.Y.Z`) on `main` at points
this file has a dated entry for — not on every commit.

## [Unreleased]

### Added (guided tour)

- **A guided tour of the editor** the first time a browser opens a project:
  five short steps — diagram, DBML panel, toolbar, shortcuts, tabs — each
  outlining what it describes, without blocking the editor. Replay it with the
  ⓘ button of the project header.

### Changed (pipeline) — read before upgrading

- **A protected stage no longer takes a schema the stage before it does not
  have.** When a project has databases on several stages, deploying to a stage
  whose protection is "Revue" or "Protégé" — the production stage always is —
  is refused (`409 PIPELINE_STAGE_SKIPPED`) until the nearest earlier stage of
  that project has received the same schema. **After upgrading, every stage
  reads "en retard" until it is deployed to once**, because past deployments
  did not record which schema they deployed: deploy to the earlier stage
  first, or set its successor's protection to "Libre". A project with a single
  database, and a database on no stage, are unaffected.
- **Skipping a stage** is for instance administrators, needs a reason, and is
  audited (`connection.deploy.stage_skipped`): in the deployment dialog once
  the refusal is shown, or `{ skipStageOrder: true, skipReason }` on the API.
- **A "Pipeline" card** on the Déploiements tab shows the project's databases
  along the stages: level, behind, failed or never deployed, and which stage
  one is waiting for.
- The deployment dialog now shows a refused deployment in the interface's
  language instead of the server's English message, and its first step says
  up front what would refuse the deployment: open lint errors (when the
  project blocks on them) and a stage that has to come first.
- Migration 33 (`deployment_history.schema_hash`).

### Fixed (DBML with several schemas)

- **Importing DBML whose tables are in more than one schema lost tables.** Only
  the first schema of the file was read, so `Table sales.orders` next to
  `Table settings` kept one of the two — on import and on every sync of the
  DBML editor. Every schema is read now.
- **A relation between tables of a named schema made the DBML unreadable**: it
  was written without the schema (`Ref: orders.x > people.id`), which the
  parser refuses. Relations are written with their schema, quoted when needed.

### Added (per-environment variables)

- **`{{variables}}` in table names and schemas**, resolved per stage: write
  `Table "{{table_prefix}}orders"` once, give `table_prefix` a value on each
  stage (Admin → Environnements, `name=value, …`), and each database gets its
  own name. Used by the deployment plan, the deployment (DDL and seeds), the
  drift check and the pull. A deployment to a stage that does not define a
  variable the schema uses is refused before anything runs
  (`409 VARIABLES_UNRESOLVED`).
- Migration 32 (`environments.variables_json`). Nothing changes for a schema
  without placeholders.

### Added (compare environments)

- **"Comparer deux environnements"** on a project's Déploiements tab, when it
  has at least two databases: both are read and set side by side — tables
  only one of them has, and for a table that differs, the columns only on one
  side and each column's type, nullability and default on both. A table that
  exists in a database but not in the schema is marked "Hors schéma". Project
  administrators; structure only, no data.

### Added (data dictionary)

- **A "Dictionnaire" tab in every project.** Each table and column gets a
  description, an owner, a classification (public, internal, personal,
  sensitive) and tags, with a completeness bar, a search and two filters (to
  document, personal data). Exports: Markdown, CSV, a self-contained HTML page.
- **Stored in the schema's notes**, as text after the description —
  `[owner: …] [class: …] [tags: …]` — so it follows history, DBML export and
  import. Existing notes are untouched and read as descriptions.
- `GET /api/v1/projects/:id/dictionary` (`?format=markdown|csv|html`).
- The linter's "table described" rule no longer counts a note made only of
  annotations as a description.

### Added (table locks)

- **"Verrous du projet".** As soon as a table is locked, a padlock with the
  count appears in the workspace bar and opens the list of every lock: level,
  who, when, why. Everyone who sees the project can read it and jump to the
  table; whoever may manage a lock changes or lifts it from there.
- **A locked table's block is read-only in the DBML editor** for those the
  lock binds: it is tinted, and typing in it is refused with a message, instead
  of being accepted and then failing to synchronise.

### Added (public API)

- **Table locks under `/api/v1`**: `GET /api/v1/projects/:id/locks`, and `PUT` /
  `DELETE /api/v1/projects/:id/locks/:table` to lock a table or lift its lock —
  the table named by its id or by its name. Same rules as in the app (project
  administrators for `project` locks, instance administrators for `instance`
  ones), behind the `projects:read` / `projects:write` scopes.

### Added (initial data from a database)

- **A table's current rows can become its initial data.** In a project's
  Données & SQL tab, a table's new "Données initiales" button — and "Reprendre
  les lignes de la base" in the seed dialog — read the rows the table holds in
  the current database and show them in the seed dialog, checked like a CSV
  file. Nothing is saved until "Enregistrer". Instance administrators only
  (it reads every row, like the console); audited as `seed.read_database`.
  Columns the schema and the database do not share, and binary columns, are
  left out and named; a table larger than a seed may be (50 000 rows, 2 MB)
  gives its first rows, and says so.

### Added (schema linter)

- **A "Problèmes" tab in every project.** The schema is checked against
  conventions as it is edited: primary key present, foreign keys indexed,
  snake_case names, `varchar` with a length, `created_at` / `updated_at`, no
  float for an amount, tables described — plus two lists of your own
  (forbidden types, columns every table must have). Findings are listed table
  by table, open their table in the schema, are underlined in the DBML editor,
  and the errors and warnings show on the table in the diagram. Two of them
  have a one-click fix (add an `id` key, create the foreign-key index).
- **Rules per project.** Project administrators pick a profile (Souple,
  Standard, Strict) or set each rule's level, and except a table from a rule;
  a table can also except itself with `lint-ignore: rule-id` in its note.
  Nothing changes for an existing project until someone does: the default is
  the Standard profile, which blocks nothing.
- **Optionally, an error stops a deployment** ("Refuser un déploiement tant
  qu'une erreur est ouverte", off by default). Checked on the server, for the
  app and `/api/v1` alike: `409 LINT_BLOCKS_DEPLOYMENT` with the findings.
- `GET /api/v1/projects/:id/lint` (scope `projects:read`) returns the same
  findings — a CI step can fail on `summary.error > 0`.
- Migration 31 (`lint_settings`). The "no primary key" warning the diagram
  already showed is now the linter's `pk-required` rule and follows the
  project's profile.

### Added (database backups) — read before upgrading

- **Backups of the connected databases.** In the database console (Admin →
  Connexions → Ouvrir, or a project's Données & SQL tab), a new **Sauvegardes**
  tab: back up now, follow the running one, download, pin, delete, restore.
  A backup is _logical_ — structure and rows read through the driver — and
  stored as one compressed, AES-256 encrypted file with a checksum. Instance
  administrators only.
- **Restore.** The chosen tables are emptied and refilled from a backup, into
  the same database or another one of the same engine, after the database's
  name is retyped. The target's current rows are backed up first. Data only:
  the tables must already exist. Not one transaction across tables — see the
  user guide.
- **A production deployment now backs the database up first.** On the stage
  flagged as production, a deployment that changes something takes a backup
  before running; if the backup does not complete (database larger than the
  limit, unreadable table), **the deployment is refused**. Untick "Sauvegarder
  la base avant de déployer" in the deployment dialog, or send
  `backupBefore: false` to `/api/v1/…/deploy`, to deploy without one. Other
  stages are unchanged (the box is there, unticked).
- **Scheduled backups.** In the Sauvegardes tab, "Sauvegarder automatiquement":
  every day, every week (on a weekday) or every month (on a day from 1 to 28),
  at an hour of the **server's clock**, keeping the last N. Off by default.
  Scheduled backups are kept by that count, not by
  `ATHANORDB_DATABASE_BACKUP_RETENTION_DAYS`. A server that was down at the
  hour runs the missed backup once when it is back.
- **Configuration:** `ATHANORDB_DATABASE_BACKUP_DIR` (default: a
  `database-backups` folder next to the app database — make sure that volume
  has the room), `ATHANORDB_DATABASE_BACKUP_MAX_MB` (512),
  `ATHANORDB_DATABASE_BACKUP_RETENTION_DAYS` (30, `0` keeps everything; pinned
  backups are never removed). These are separate from `ATHANORDB_BACKUP_*`,
  which still concern AthanorDB's own data.
- **Secret rotation** (`npm run rotate-secret`) now also covers the backups'
  keys. Losing `ATHANORDB_SECRET` makes the stored backups unreadable, like
  the stored connections.
- Migrations 29 (`backups`, `deployment_history.backup_id`) and 30
  (`backup_schedules`). Deleting a
  connection deletes its backups.
- Verified on SQLite end to end. On PostgreSQL, MySQL, SQL Server and Oracle
  the code path is written but has not been run against a live server yet:
  try a backup and a restore on a copy before relying on it.

### Changed (project workspace)

- **A project now opens on a workspace with tabs**: Schéma (the editor),
  Données & SQL (the database console, for instance administrators),
  Déploiements (history, rollback, deploy — for project administrators) and
  Historique. Each tab has its own address (`/project/<id>/data`,
  `/deployments`, `/history`). The revision history is a page instead of a
  dialog, and the toolbar's "Historique" button is replaced by the tab.
- **SQL under the diagram.** On the Schéma tab, instance administrators can
  open a SQL panel below the canvas (button in the tab bar, or `Ctrl+J`) on the
  project's current database; a table's "Voir les données" button shows its
  first rows there. Same rules as the console: read-only unless switched,
  audited, structure sent to the schema.
- **Reverse proxies:** nothing to change if `/` is proxied as a whole. A proxy
  that listed the application's paths one by one needs `/project/*/*` as well.
  No database or configuration change.

### Added (watch for outside changes)

- **A project can watch its databases.** Déploiements → "Surveiller les
  modifications hors Athanor": on, how often (5 minutes to daily), tables to
  ignore, "Vérifier maintenant". Each database that was deployed to or pulled
  from is read again and compared with the state that left it; a difference
  nothing in Athanor explains is recorded once, turns on the editor's drift
  banner, and is sent to the project's webhooks (new event `drift.detected`).
  A deployment that failed half-way is named as the likely cause. A database
  that cannot be read is reported "injoignable", never as a change. A
  deployment or a pull settles what was found; "Ignorer" waves it off for good.
  Off by default; project administrators turn it on. API:
  `GET/PUT /api/projects/:id/monitoring`, `POST …/monitoring/check`.
- **Fixed:** dates read from the server (deployment history, error log…) were
  shown as local time while they are UTC — hours off outside UTC.
- **Database change:** migration 28 adds `monitor_settings` and
  `drift_events`. Automatic, one-way.

### Changed (admin activity)

- **Admin → Activité replaces the audit tab.** One list of what was done
  through Athanor — structure, data, deployments, accounts, sessions,
  projects, configuration — filtered by period, type, project, database and
  text, paged ("Entrées plus anciennes"), each entry opening on its detail
  (actor, full detail, project with a link, database, IP, request id), and
  exportable as CSV or JSON with the same filters. Read-only, admin-only, as
  before. API: `GET /api/admin/activity`, `GET /api/admin/activity/export`.
- Audit entries now record the project and the database they concern and the
  request that produced them; request ids are UUIDs (they were a per-process
  counter, `req-1`…), also in the server log.
- **Database change:** migration 27 adds `project_id`, `connection_id` and
  `correlation_id` to `audit_log` and fills the first two for older entries
  whose target was a project or a connection. Automatic, one-way.

### Added (test data)

- **Generate test rows for a table** — the "Générer" tab of its initial data:
  a generator per column, suggested from its name and type (e-mail, phone,
  first name, city, dates, numbers, weighted choices, UUID, sequence, fixed
  value…), a volume (up to 10 000), a seed that makes the run repeatable, a
  locale (French, English). Built from the structure only — no real row is
  read; a foreign key draws from the parent table's initial data. NOT NULL,
  unique columns and declared lengths are respected. The rows can be exported
  as CSV or used as the table's initial data, where they are checked like any
  file. The settings are kept per table.
- An extension point (`DataGeneratorProvider`) lets another generator — an AI
  service, later — plug in; only the built-in one exists, and nothing enables
  another. API: `/api/projects/:id/generators/:tableId[/run]`.
- **Database change:** migration 26 adds the `generator_configs` table.

### Added (initial data)

- **Tables can bring rows: CSV seeds.** On the canvas, a table's "Données
  initiales" button takes a CSV file (2 MB / 50 000 rows at most, separator
  detected, UTF-8 or Windows-1252), matches its columns to the table's by name,
  and previews it checked against the table: types, NOT NULL, lengths,
  duplicates under a key, required columns left out, formula-looking text. A
  table with a seed shows it in its header.
- **Deployments insert them after the DDL**, parents before the tables that
  point at them, one transaction per table, with bound parameters. By default
  only into an empty table, so a second deployment adds nothing ("Toujours
  ajouter" changes that). The plan lists `customers : +248 lignes` and can
  leave the seeds out; a seed with errors, a foreign key with no parent in the
  parent's seed, or seeded tables depending on each other in a cycle stop the
  deployment before anything runs (`409 SEEDS_NOT_DEPLOYABLE`). What each
  table got is kept in the deployment history. API: `skipSeeds` on deploy.
- A `full` table lock now also freezes the table's seed.
- **Database change:** migration 25 adds the `table_seeds` table and
  `deployment_history.seed_report`. Automatic, one-way.

### Changed (deployment safety) — read before upgrading

- **"Annuler / Gérer manuellement" now cancels.** The option was offered on
  every risk of a deployment plan and then ignored: the change ran anyway — a
  dropped column with data was dropped. A deployment with a risk set to it is
  now refused (`409 DEPLOYMENT_BLOCKED_BY_RISK`).
- **The plan measures more, and reads no rows.** Besides dropped tables and
  columns, type changes and NOT NULL over NULLs, it now checks a new NOT NULL
  column without a default on a table with rows, a text limit below the
  longest value, a new unique constraint over duplicates and a new foreign key
  over orphans — on every engine (SQL Server and Oracle only checked dropped
  tables). Only aggregates are run (counts, maximum lengths), each bounded in
  time; the plan no longer shows sample values from the database. A check that
  could not run is shown as "non mesuré", never as safe.
- **The server measures again when deploying**, whatever the client sent. On
  the production stage every critical risk needs an explicit answer: an API
  call with no `resolutions` gets `409 DESTRUCTIVE_CHANGE_UNRESOLVED` instead
  of the defaults. **API scripts deploying to production must send their
  resolutions.**
- **Accepted risks are kept with the deployment** — what was at stake, what
  was chosen, and an optional reason (`riskNote`), shown in its history.
- **The SQL preview follows the answers** given in the plan instead of showing
  the first draft.
- **Fixed:** a size change on a text column (`varchar(320)` → `varchar(255)`)
  was not seen by the deployment diff, so nothing was deployed.
- **Database change:** migration 24 adds `accepted_risks` and `risk_note` to
  `deployment_history`. Automatic, one-way.

### Changed (environments) — read before upgrading

- **Environments are now configured stages**, not a free-text label on each
  connection. Admin → Environnements holds the chain (name, colour, order,
  protection) and at most one **production** stage. Migration 23 turns every
  label already in use into a stage (one per distinct label, ignoring case),
  guesses the order (dev first, production last) and flags as production the
  label that reads as such (`prod`, `production` — not `preprod`); an
  instance with no labels gets DEV › Staging › Prod. **Check the result in
  Admin → Environnements after upgrading.** Deployment history keeps the names
  it recorded.
- **Deploying to, or rolling back on, the production stage asks for the
  connection's name** — in the app (a retype dialog) and in the API:
  `POST /api/v1/…/deploy` and `…/rollback` answer `409
PRODUCTION_CONFIRMATION_REQUIRED` unless the body carries
  `"confirmName": "<connection name>"`. **Scripts that deploy to a connection
  labelled "production" through the API need that field after the upgrade.**
- **A connection's `environment` must name an existing stage** (or send
  `environmentId`); an unknown name is refused with `404
ENVIRONMENT_NOT_FOUND` instead of being stored as typed.
- **Database change:** migration 23 adds the `environments` table and
  `db_connections.environment_id`. Automatic, one-way.

### Added (history)

- **The history reads as a timeline.** Newest first; edits made close together
  by one person are one line ("3 étapes", expandable), each with the tables it
  touched; a "Mes modifications" filter; lock changes, restores and — for
  project administrators — deployments and rollbacks appear among the
  revisions.
- **Preview on the diagram.** "Aperçu sur le graphe" outlines on the canvas the
  tables added (green) or changed (orange) since a revision, and names those
  deleted since. The preview follows edits made meanwhile.
- **Restore one table.** From a revision's list of changes or from the preview,
  a single table can be put back as it was — the rest of the schema stays as it
  is now. Its own foreign keys come back with it. A locked table still refuses
  it. `POST /api/projects/:id/revisions/:revisionId/restore` takes an optional
  `{ "tableIds": [...] }`.
- **Fixed:** revision times in the history were shown as if UTC were local time
  (two hours early in Paris in summer).
- No database or configuration change. The undo stack (`Ctrl+Z`) is now
  capped at 200 steps per session.

### Added (drift)

- **The editor says when a linked database was changed outside the schema.**
  After a table or index change made from the console (policies "Avertir" and
  "Libre"), every project modelling that database shows a banner, with — for
  its administrators — the number of differences and the choice to view them,
  resynchronise the schema from the database, or dismiss. A deployment or a
  pull clears it. Changes made by other tools are not detected yet.
- **Database change:** migration 22 adds the `schema_fingerprints` table and
  two columns on `project_connection_links`. Automatic, one-way.

### Changed (database console) — read before upgrading

- **On a database that a project models, the console no longer changes tables
  or indexes by default.** Dropping a table or a column from the explorer, or
  running `CREATE / ALTER / DROP TABLE|INDEX` in the SQL console, is refused
  and points to the project instead: the change is made in the schema and
  deployed. This applies as soon as the instance is upgraded, to every
  connection attached to at least one project. To get the previous behaviour
  back, an instance administrator sets **Admin → Connexions → Structure des
  bases liées à un projet** to "Libre" (or "Avertir": allowed after
  confirmation, and logged as done outside the schema). Each connection can
  also have its own setting. Connections attached to no project, data
  statements, views, functions and whole databases are unaffected.
- **Database change:** migration 21 adds the `instance_settings` table and two
  columns on `db_connections`. Automatic, one-way.
- **API:** `POST /api/admin/connections/:id/query` and `…/drop` can now answer
  `409` with `STRUCTURE_VIA_SCHEMA` or `STRUCTURE_CONFIRMATION_REQUIRED`.

### Added (table locks)

- **A project administrator can lock a table.** Its structure — name, columns,
  types, constraints, indexes, the foreign keys it carries, and its deletion —
  is then frozen for everyone else, on every way of writing a schema: canvas,
  DBML editor, import, history restore, pull from a database and `/api/v1`.
  Moving, recolouring and commenting stay open. An instance administrator can
  place a lock that only instance administrators can lift. Who can do what is
  now written down in `docs/permissions.md`.
- **Database change:** migration 20 adds the `table_locks` table. Automatic,
  one-way; nothing to do by hand.
- **API:** a write that touches a locked table now answers `403` with code
  `TABLE_LOCKED` and the list of tables (`tables`). Scripts that import into a
  project with locks should expect it.

### Fixed (database connections)

- **Pulling a schema from a database lost its relations.** Tables were given
  new ids while the relations kept the ones from the introspection, so every
  relation pointed at a table that did not exist. Relations now follow their
  tables, on a first pull and on later ones.

### Changed (interface)

- **The app's own form controls.** Dropdowns, menus, checkboxes, switches,
  number fields, confirmation dialogs and transient messages are now drawn by
  the app (`apps/web/src/components/ui/`) rather than by the browser, so they
  look the same on every platform and work from the keyboard. First screens
  using them: the DBML editor's behaviour settings and the editor switches in
  Settings; the others follow screen by screen. No database or configuration
  change.

### Fixed (DBML editor)

- **Hand edits no longer get "rolled back".** Retargeting a `Ref:` by hand
  could bring the old relation back next to the new one (when typing paused on
  a half-written table name), and a buffer using `<` or an inline `[ref: …]`
  was replaced wholesale by the generated layout — comments included — after
  every sync. The buffer now wins while it is the newer of the two, and a
  relation is recognised however it is written. No database or configuration
  change.

### Added (canvas)

- **Copy / paste tables** with `Ctrl/Cmd+C` / `Ctrl/Cmd+V` or the canvas
  context menu — within a project, between projects and tabs, and as DBML
  text into the DBML editor. Colours, columns, indexes and settings are kept;
  the copy is named `<name>_copy` (`_copy2`, … when taken) and relations
  between copied tables follow them. `Ctrl+D` now picks a free name the same
  way instead of creating a second `<name>_copy`.

### Added (DBML editor)

- **Editor behaviour settings** (⚙ in the editor's status bar, stored per
  browser): automatic formatting (never by default, or on save), completion
  while typing, bracket closing, and the delay before the text is sent to the
  diagram — including "only on Ctrl+S". The status bar now shows whether the
  text and the diagram agree (`Synced` / `Pending` / `Error on line n`).

### Added (database administration)

- **Instance-level database connections.** Connections are now created,
  edited and deleted by an instance administrator in **Admin → Database
  connections**, then attached to the projects that may use them — one
  connection can serve several projects. Oracle joins PostgreSQL,
  MySQL/MariaDB, SQL Server and SQLite in the form. Each connection has tags,
  a reachability status (checked on demand and in the background) and an
  optional **read-only** flag that makes AthanorDB refuse to write through it.
  **Database:** migration 18 moves `project_connections` to `db_connections`
  - `project_connection_links` (ids preserved, deployment history kept).
    **Behaviour change:** through a project (web or `/api/v1`), deleting a
    connection now detaches it, and a connection created by an instance admin
    can be used but not edited. **Config:**
    `ATHANORDB_CONNECTION_HEALTH_INTERVAL_MINUTES` (default 15, `0` = off).
- **Database console** for each connection (instance administrators only):
  an explorer (databases, schemas, tables, paged data with CSV export,
  structure), a SQL console (read-only by default; write mode is explicit,
  confirmed, time- and row-capped; per-admin history), drop of a column,
  table, view or database behind a SQL preview and the object's name typed
  back, and a session monitor with kill. Everything is recorded in the audit
  log. **Database:** migration 19 adds `admin_query_history`.
- **Database users and permissions.** List the target server's accounts and
  roles and what they are granted; create, drop, lock, change a password,
  manage role membership, grant and revoke — each shown as SQL before it
  runs. Covers PostgreSQL, MySQL/MariaDB (`user@host`), SQL Server (logins
  and database users) and Oracle; SQLite has no accounts. Passwords are never
  stored or logged.
- Also in this release, previously unlisted: **New project from database**,
  **table duplication** on the canvas, and **Check differences** between a
  project and a connected database.

### Security

- **DNS rebinding closed for database connections.** The target host is
  resolved once, checked, and the driver connects to that exact address
  (host/port configs and PostgreSQL/MySQL URLs). A host hidden in a
  connection string used to skip the metadata-endpoint check entirely; it no
  longer does, for any engine.
- **A project administrator could act on another project's connection** by
  knowing its id (update, delete, pull, plan, deploy). Project routes now
  only resolve connections attached to that project.
- **Encryption key rotation.** Stored secrets carry a format version, and
  `ATHANORDB_SECRET_PREVIOUS` + `npm run rotate-secret` re-encrypt everything
  under a new `ATHANORDB_SECRET`. Existing data stays readable as is.
- **`ATHANORDB_SQLITE_DIR`** restricts SQLite connections to one directory
  (opt-in; symlinks are resolved).
- The connection routes of the web UI now also have a per-caller rate limit.

### Added (API)

- **OpenAPI description of the public API** at `GET /api/v1/openapi.json`, for
  Postman, Swagger UI or generating a client. Kept in sync with the routes and
  `docs/public-api.md` by a test.

### Added (webhooks)

- **Webhooks.** A project can notify Slack, Discord or any HTTP endpoint when
  its schema changes (grouped after 30 s without edits) or a deployment
  finishes. JSON payloads are signed (HMAC-SHA256); failed deliveries are
  retried for about 9 hours. Managed by project administrators from the
  project card. See [`docs/webhooks.md`](docs/webhooks.md). **Database:**
  migration 17 adds `project_webhooks` and `webhook_deliveries`. Requires
  `ATHANORDB_SECRET` (signing secrets are stored encrypted).

### Security

- **Deleting a project now deletes its database connections** (and their
  stored credentials), deployment history and project-restricted API keys.
  They used to be left behind. **Operators:** rows orphaned by earlier
  deletions remain — see the note in `docs/todo.md` (Phase 27) for the
  one-off cleanup query.

- **Per-database rate limit.** Operations against a connected database (test,
  pull, plan, deploy, rollback) are now capped per target database — 30 a
  minute, and 5 executed migrations/rollbacks a minute — whichever user, tab
  or API key they come from. Previously the web UI's connection routes had
  no limit at all.

### Fixed

- **Column defaults written as expressions** (`` default: `now()` ``) no longer
  turn into the string `'now()'` in the DBML panel, and `ALTER … SET DEFAULT`
  no longer quotes them. A string that merely looks like a call (`'now()'`)
  stays a string. Existing projects are corrected the next time their DBML is
  edited.
- **Foreign keys on the wrong table.** A relation written inline in DBML
  (`author_id integer [ref: > users.id]`, or `users.id [ref: < posts.author_id]`)
  was stored backwards: SQL export, migration SQL and **deployments** put the
  foreign key on the referenced table, and the canvas's "1/n" labels were
  swapped for relations written the explicit way. Every DBML spelling now
  means the same thing. **Existing projects are repaired automatically** the
  first time they are opened after upgrading — the fix appears in the project's
  history as "AthanorDB (sens des relations corrigé)". Only relations that are
  unambiguously inverted are touched. **If you deployed a schema from
  AthanorDB before this release, check its foreign keys.**

### Added

- **Search inside every schema.** The dashboard search box also finds tables,
  columns and enums by name across all the projects you can see; a result opens
  the project centred on that table.
- **Compare two projects.** _Compare_ in the editor shows name-matched
  differences with another project, and the migration SQL between them (5
  dialects, either direction).

- **Email, self-service password reset, emailed invitations.** Optional SMTP
  configuration (`ATHANORDB_SMTP_*`, plus `ATHANORDB_PUBLIC_URL` for the links —
  see the README's configuration table). With it set, invitations are emailed
  to the invitee, and the login page offers _Forgot your password?_: a
  single-use link valid for one hour, whose use signs out every session of the
  account and clears a login lockout. Without it, nothing changes — invitation
  links are still copied by hand. **Database:** migration 16 adds a
  `password_reset_tokens` table (hashes only). **Operators:** if your SMTP
  relay is a third-party service, it now processes users' email addresses —
  mention it in your privacy policy.

- **Project templates.** _From a template_ on the dashboard creates a project
  seeded with a starter schema — blog, e-commerce, multi-tenant SaaS or
  authentication — already related and laid out on the canvas. Also available
  over the API: `POST /api/projects` and `POST /api/v1/projects` accept an
  optional `template`.

- **Account offboarding.** Administrators can disable an account (reversible,
  kills its sessions and closes its live WebSockets immediately) or delete it
  permanently, choosing whether the projects it owns are transferred to another
  account or left ownerless. Previously there was no way to remove anyone's
  access short of changing their password.
- **Session management.** Users can see their own active sessions (device, IP,
  last activity) and revoke any of them individually, or log out everywhere
  else, from _Settings → Profile_.
- **Audit log.** Destructive and permission-shaped actions — project deletion,
  archiving, imports, exports, grant changes, team membership, password resets,
  account disable/delete, invitations, locked logins — are recorded and readable
  by administrators under _Admin console → Audit log_. Schema edits are not
  recorded here; they are already in each project's own revision history.
- **Per-account login lockout.** Ten failed attempts against one account locks
  it for fifteen minutes, complementing the existing per-IP rate limit which a
  slow or distributed attempt could stay under.
- **Error boundary.** A render-time exception now shows a recoverable error
  screen instead of a blank page, with a "back to my projects" path out of a
  crashed editor.
- **Per-account project cap** (500) as an abuse backstop, alongside the existing
  per-project entity limits.
- **Scheduled backups.** The server can now run the existing backup itself
  (`ATHANORDB_BACKUP_INTERVAL_HOURS`, off by default), keeping the newest
  `ATHANORDB_BACKUP_KEEP` runs and pruning the rest. The backup → restore round
  trip is now covered by tests, so it runs in CI rather than being first tried
  during an incident.
- **Personal data export and self-service account deletion.** _Settings →
  Profile_ can download everything the instance holds about you as JSON, and
  delete your account behind a password re-check. Projects you own are kept and
  left ownerless — they may be shared with a whole team.
- **Choosable session length.** "Stay signed in for 30 days" is on by default;
  unchecking it gives a 12-hour session in a cookie the browser drops when it
  closes.
- `ATHANORDB_LOG_LEVEL`, plus redaction of session cookies and `Authorization`
  headers from logs.
- Loading placeholders on the dashboard.
- **Audit log retention.** `ATHANORDB_AUDIT_RETENTION_DAYS` (365 by default,
  `0` to keep everything) purges old entries on the hourly sweep. The audit
  table was the only one with no ceiling.
- **Legal templates** in `docs/legal/`: terms of service and a privacy policy
  written against what the software actually stores and for how long, with an
  index explaining that whoever runs an instance — not this project — is the
  operator and the data controller. Drafts, requiring review by a lawyer.
- `npm audit` runs in CI (non-blocking).
- `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and a user guide
  (`docs/user-guide.md`).

### Changed

- **Write permissions are re-evaluated live.** A connection's write access used
  to be resolved once, when the WebSocket opened: downgrading someone to
  view-only, or removing them from a project, left them editing until they
  happened to reconnect. Access is now re-checked (immediately when a grant
  changes, otherwise at most 5 seconds later), and a user who has lost access
  entirely is disconnected.
- `GET /api/health` now queries the database and reports live room count and
  uptime, returning 503 if the database is unreachable. It previously returned
  `{"status":"ok"}` unconditionally, which the Docker `HEALTHCHECK` could not
  distinguish from a healthy server.
- Landing page, pricing and settings copy now describe what the product
  actually does: the unavailable hosted tier is marked as such rather than
  advertised with a price and a trial button, unbuilt enterprise features are
  marked planned rather than included, PDF export is no longer described as
  vector (it embeds a raster snapshot), and "local-first" was replaced with
  "self-hosted" — state lives on the server and the browser needs a connection
  to it.

- Every user-facing string is now French. The admin console, both password
  flows and the team modals were still English.

### Fixed

- **Memory leak in room eviction.** When the last client left a project, the
  room was dropped from the server's map but its `Awareness` instance kept a
  live `setInterval`, which kept the Y.Doc and the project's entire contents
  resident for the lifetime of the process — for every project ever opened.
- **Another account's project list could appear after re-login.** Nothing reset
  the dashboard's state across a logout, so signing in as a different user
  briefly rendered the previous user's projects from stale state.
- The dashboard told users with projects that they had none while the first
  request was still in flight — "empty" and "not loaded yet" were the same
  empty array.
- **Web fonts are now self-hosted.** They were loaded from
  `fonts.googleapis.com`, so every visitor's browser disclosed its IP address
  and user agent to a third party — while the app claimed to depend on no
  external service. The latin and latin-ext subsets ship with the app (244 kB);
  the design is unchanged and the page now makes no third-party requests at
  all.

### Upgrade notes

- Migrations 3–7 run on first boot: `users.disabled_at`,
  `sessions.user_agent`/`sessions.ip`/`sessions.ttl_ms`, and the new
  `login_attempts` and `audit_log` tables. No manual step is required.
- New optional environment variables, all with safe defaults that preserve
  current behaviour: `ATHANORDB_LOG_LEVEL`, `ATHANORDB_BACKUP_INTERVAL_HOURS`
  (backups stay off unless set), `ATHANORDB_BACKUP_DIR`, `ATHANORDB_BACKUP_KEEP`.

## [0.0.1]

Initial development series: DBML-native visual editor, real-time multi-user
editing over Yjs, project history, accounts/teams/invitations, import and
export (DBML, PostgreSQL, MySQL, SQL Server), sandboxed plugin system, backup
and restore, Docker packaging. See `docs/todo.md` for the phase-by-phase record.
