# Changelog

Notable changes to AthanorDB. The project is pre-1.0 and self-hosted: this file
exists so an operator upgrading an instance can tell, before pulling, whether a
release changes the database, the configuration, or anything they have to do by
hand.

Database migrations run automatically at boot (`apps/server/src/migrations.ts`,
tracked with `PRAGMA user_version`) and are one-way — take a backup before
upgrading (`npm run backup -- <dir>`).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Account offboarding.** Administrators can disable an account (reversible,
  kills its sessions and closes its live WebSockets immediately) or delete it
  permanently, choosing whether the projects it owns are transferred to another
  account or left ownerless. Previously there was no way to remove anyone's
  access short of changing their password.
- **Session management.** Users can see their own active sessions (device, IP,
  last activity) and revoke any of them individually, or log out everywhere
  else, from *Settings → Profile*.
- **Audit log.** Destructive and permission-shaped actions — project deletion,
  archiving, imports, exports, grant changes, team membership, password resets,
  account disable/delete, invitations, locked logins — are recorded and readable
  by administrators under *Admin console → Audit log*. Schema edits are not
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
- **Personal data export and self-service account deletion.** *Settings →
  Profile* can download everything the instance holds about you as JSON, and
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
