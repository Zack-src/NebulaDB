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
`package.json` shares one version number — until the "V1" checklist in
[`docs/v1-roadmap.md`](docs/v1-roadmap.md) clears, at which point the next
release is tagged `1.0.0`. Chosen over calendar versioning: this project ships
when something is ready, not on a schedule, and `0.x` already signals
"pre-1.0, breaking changes possible between minors" without needing a second
convention layered on top. Releases are tagged (`vX.Y.Z`) on `main` at points
this file has a dated entry for — not on every commit.

## [Unreleased]

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
