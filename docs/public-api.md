# Public API (`/api/v1`)

A stable, versioned REST surface for scripts, CI pipelines and other tools —
separate from the internal `/api/*` routes the web app itself uses (those
stay cookie-session-only and are not a stable contract).

## Authentication

Any user can create their own keys in **Settings → API keys** — for every
project they can see, or restricted to a single one — or via the
session-authed management endpoints below. Every `/api/v1` request needs it:

```
Authorization: Bearer adb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The key authenticates **as the user who created it** — it can do anything
that user's own project permissions allow, narrowed by whatever scopes and
project restriction you gave it at creation time. Only a SHA-256 hash of the
key is ever stored; the full value is shown once, at creation, and cannot be
retrieved again — treat a lost key as gone and issue a new one.

### Scopes

| Scope                 | Grants                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects:read`       | List/read projects, export DBML/SQL/SVG/PNG, schema history, IAM, deployment history                                                                                                                                      |
| `projects:write`      | Create/rename/archive/delete a project, import/edit its schema, IAM grant/revoke                                                                                                                                          |
| `deployments:trigger` | Run a deployment or rollback against a connected database                                                                                                                                                                 |
| `connections:manage`  | Create/update/delete/test a database connection, pull a live schema onto the canvas; give one's own account on a database that asks for it; take, download and delete a database's backups (instance administrators only) |
| `teams:manage`        | Create/rename/delete a team, add/remove its members — instance-wide, global-admin-only                                                                                                                                    |

A key with no matching scope gets `403 API_SCOPE_INSUFFICIENT`, not a silent
downgrade. A key created with a specific `projectId` only works against that
one project (`403 API_KEY_PROJECT_RESTRICTED` against any other) — omit it
for a key that should follow whatever projects its owner can see. Team and
backup routes are instance-wide, not project-scoped — a project-restricted
key is refused outright (`403 API_KEY_PROJECT_RESTRICTED`) rather than let
through unscoped.

### Key management (session-only)

These are reachable from a browser session but **not** from another API
key — a key that could mint or revoke keys would let one leaked key
escalate into every key its owner has.

| Method   | Path            | Body                                          |
| -------- | --------------- | --------------------------------------------- |
| `GET`    | `/api/keys`     | —                                             |
| `POST`   | `/api/keys`     | `{ name, scopes: ApiKeyScope[], projectId? }` |
| `DELETE` | `/api/keys/:id` | —                                             |

## Endpoints

All project routes take a permission check identical to the web app's own
(`view` for reads, `edit` for the import, project `administrator` for
deploy/rollback/IAM/delete) — a scope only ever narrows what the key can do
on top of that, it never grants more than the underlying user already has.
"(+ admin)" below means the caller also needs project `administrator`, the
same elevated permission the equivalent internal route requires — a scope
alone is never enough for these.

| Method   | Path                                                             | Scope                      | Notes                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/projects`                                               | `projects:read`            | Every project the caller can see, with their permission level                                                                                                                                                                                                  |
| `POST`   | `/api/v1/projects`                                               | `projects:write`           | `{ name, template? }` — create a new project, empty or seeded from a starter template (`blog`, `ecommerce`, `saas`, `auth`)                                                                                                                                    |
| `GET`    | `/api/v1/projects/:id`                                           | `projects:read`            |                                                                                                                                                                                                                                                                |
| `PATCH`  | `/api/v1/projects/:id`                                           | `projects:write` (+ admin) | `{ name?, status? }` — rename and/or archive/trash/restore                                                                                                                                                                                                     |
| `DELETE` | `/api/v1/projects/:id`                                           | `projects:write` (+ admin) | Permanent delete — irreversible                                                                                                                                                                                                                                |
| `GET`    | `/api/v1/projects/:id/history`                                   | `projects:read`            | Schema revision log (Yjs update history), same as the app's history panel                                                                                                                                                                                      |
| `GET`    | `/api/v1/projects/:id/dictionary`                                | `projects:read`            | Data dictionary read from the schema's notes (`{ projectName, tables, enums, completeness }`); `?format=markdown\|csv\|html` returns it as a document                                                                                                          |
| `GET`    | `/api/v1/projects/:id/locks`                                     | `projects:read`            | Table locks (`{ locks, canManage }`): which tables are frozen, at what level, by whom and why                                                                                                                                                                  |
| `PUT`    | `/api/v1/projects/:id/locks/:table`                              | `projects:write` (+ admin) | `{ level: "structure"\|"full", authority?: "project"\|"instance", reason? }` — lock a table or change its lock; `:table` is the table's id or name. An `instance` lock needs an instance administrator                                                         |
| `DELETE` | `/api/v1/projects/:id/locks/:table`                              | `projects:write` (+ admin) | Lift the lock                                                                                                                                                                                                                                                  |
| `GET`    | `/api/v1/projects/:id/webhooks`                                  | `projects:read` (+ admin)  | The project's outgoing webhooks (`{ webhooks }`) — address, format, events, state; never the signing secret                                                                                                                                                    |
| `POST`   | `/api/v1/projects/:id/webhooks`                                  | `projects:write` (+ admin) | `{ url, format?: "json"\|"slack"\|"discord", events? }` — answers `{ webhook, secret }`; the secret is shown this once (see [`webhooks.md`](webhooks.md))                                                                                                      |
| `PATCH`  | `/api/v1/projects/:id/webhooks/:hookId`                          | `projects:write` (+ admin) | `{ url?, format?, events?, enabled? }` — switching one back on resets its failure count                                                                                                                                                                        |
| `DELETE` | `/api/v1/projects/:id/webhooks/:hookId`                          | `projects:write` (+ admin) | Deletes the webhook and its delivery log                                                                                                                                                                                                                       |
| `POST`   | `/api/v1/projects/:id/webhooks/:hookId/rotate-secret`            | `projects:write` (+ admin) | A new signing secret for the same webhook: `{ webhook, secret }`. The old one stops signing at once                                                                                                                                                            |
| `POST`   | `/api/v1/projects/:id/webhooks/:hookId/test`                     | `projects:write` (+ admin) | Sends a `ping` now and answers the delivery (`status`, `responseStatus`, `error`)                                                                                                                                                                              |
| `GET`    | `/api/v1/projects/:id/webhooks/:hookId/deliveries`               | `projects:read` (+ admin)  | The 20 most recent deliveries (`{ deliveries }`) — never the response body                                                                                                                                                                                     |
| `GET`    | `/api/v1/projects/:id/lint`                                      | `projects:read`            | Schema linter findings (`{ profile, blockDeployment, summary, findings }`) with the project's own rules — a CI step can fail on `summary.error > 0`                                                                                                            |
| `GET`    | `/api/v1/projects/:id/iam`                                       | `projects:read`            | Teams granted access to this project and their permission level                                                                                                                                                                                                |
| `PUT`    | `/api/v1/projects/:id/iam/:teamId`                               | `projects:write` (+ admin) | `{ permission: "view"\|"edit"\|"administrator" }` — grant or change a team's access                                                                                                                                                                            |
| `DELETE` | `/api/v1/projects/:id/iam/:teamId`                               | `projects:write` (+ admin) | Revoke a team's access                                                                                                                                                                                                                                         |
| `GET`    | `/api/v1/projects/:id/export/dbml?visual=1`                      | `projects:read`            | `visual=1` includes the position/style sidecar so a re-import is lossless                                                                                                                                                                                      |
| `GET`    | `/api/v1/projects/:id/export/sql?dialect=postgres\|mysql\|mssql` | `projects:read`            |                                                                                                                                                                                                                                                                |
| `GET`    | `/api/v1/projects/:id/export/svg`                                | `projects:read`            | Server-rendered from the schema's stored layout — a fast, simple diagram, not a pixel-perfect copy of the app's own canvas export                                                                                                                              |
| `GET`    | `/api/v1/projects/:id/export/png`                                | `projects:read`            | The same SVG, rasterised (`sharp`)                                                                                                                                                                                                                             |
| `POST`   | `/api/v1/projects/:id/import`                                    | `projects:write`           | `{ source, dialect?, baseline? }` — same three-way merge (`baseline`) the DBML panel uses to avoid clobbering a concurrent edit. Canvas-only changes (table position/color) can be pushed the same way, by importing DBML text carrying the `visual=1` sidecar |

### Connections

| Method   | Path                                                                   | Scope                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/projects/:id/connections`                                     | `projects:read`                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST`   | `/api/v1/projects/:id/connections`                                     | `connections:manage` (+ admin)  | `{ name, engine, ...credentials }` — create a connection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUT`    | `/api/v1/projects/:id/connections/:connId`                             | `connections:manage` (+ admin)  | Partial update — an omitted password is preserved, not cleared. `403 CONNECTION_MANAGED_BY_ADMIN` for a connection created in the admin console                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DELETE` | `/api/v1/projects/:id/connections/:connId`                             | `connections:manage` (+ admin)  | Detaches the connection from the project; it is deleted as well if this project created it and no other project uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST`   | `/api/v1/projects/:id/connections/test`                                | `connections:manage` (+ admin)  | Tests a config without saving it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST`   | `/api/v1/projects/:id/connections/:connId/pull`                        | `connections:manage` (+ admin)  | Introspects the live database and merges it onto the canvas, preserving existing tables' ids/positions/styles by name match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST`   | `/api/v1/projects/:id/connections/:connId/deploy`                      | `deployments:trigger` (+ admin) | `{ resolutions?, confirmName?, backupBefore? }` — runs the identical introspect → diff → generate → execute → record pipeline as the app's own deploy button. On the production stage `confirmName` (the connection's name) is required and the database is backed up first unless `backupBefore: false`; a backup that does not complete refuses the deployment (`502 BACKUP_FAILED`). The answer carries `backupId`. A stage whose protection is not `free` refuses a schema the stage before it does not have yet (`409 PIPELINE_STAGE_SKIPPED`); `{ skipStageOrder: true, skipReason }` passes it, for an instance administrator's key only |
| `GET`    | `/api/v1/projects/:id/pipeline`                                        | `projects:read` (+ admin)       | The project's databases along the stages: per database the last deployment and `level` (it has the current schema), per stage `requires` / `ready` — what a job reads before deploying to the next stage                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET`    | `/api/v1/projects/:id/monitoring`                                      | `projects:read`                 | The watch over the project's databases: `{ settings, events }` — what changed outside the schema (`external`, `partial-deployment`) or could not be read (`unreachable`), open or settled                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PUT`    | `/api/v1/projects/:id/monitoring`                                      | `projects:write` (+ admin)      | `{ enabled, intervalMinutes: 5\|15\|60\|360\|1440, ignoreTables? }` — switch the watch on or off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST`   | `/api/v1/projects/:id/monitoring/check`                                | `projects:read` (+ admin)       | Reads every database of the project now and answers `{ result: { checked, changes, unreachable }, settings, events }` — a CI step can stop on `result.changes > 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST`   | `/api/v1/projects/:id/connections/compare`                             | `projects:read` (+ admin)       | `{ sourceId, targetId }` — reads both databases and answers the tables that differ (`only-source`, `only-target`, `different` with the column detail) and whether the schema models them. Changes nothing                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`    | `/api/v1/projects/:id/connections/:connId/history`                     | `projects:read` (+ admin)       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST`   | `/api/v1/projects/:id/connections/:connId/history/:historyId/rollback` | `deployments:trigger` (+ admin) | Re-runs the stored inverse SQL for a past deployment — refused if already rolled back, or if none was generated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET`    | `/api/v1/connections/:id/credentials`                                  | `connections:manage` (+ admin)  | The caller's own database account on a connection that asks each user for theirs: `{ authMode: "shared"\|"personal", username, updatedAt }` — `username` is `null` when none was given; never the password                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT`    | `/api/v1/connections/:id/credentials`                                  | `connections:manage` (+ admin)  | `{ username, password }` — tried on the database before it is kept (`400 PERSONAL_CREDENTIALS_REJECTED` when the database refuses it), stored encrypted, never returned. `409 PERSONAL_CREDENTIALS_NOT_USED` for a connection that uses one shared account                                                                                                                                                                                                                                                                                                                                                                                      |
| `DELETE` | `/api/v1/connections/:id/credentials`                                  | `connections:manage` (+ admin)  | Removes the caller's own account from the connection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

All connection routes but `GET` (list) require project `administrator` —
they open a connection to a host/file the caller supplies, or execute
generated SQL against it, a materially larger blast radius than a plain
schema edit.

Connections are instance-level objects: one can be attached to several
projects. These routes only ever see the connections attached to `:id` — a
`:connId` that belongs to another project answers `404` — and history is the
project's own deployments through that connection. A connection created by an
instance administrator (admin console) can be used from here but not edited;
one marked read-only refuses `deploy` and `rollback` with
`403 CONNECTION_READ_ONLY`. Creating, editing and administering instance-level
connections (explorer, SQL console, database users) is done in the web admin
console and is not part of `/api/v1` — their backups excepted, below.

A connection can ask each user for **their own database account** instead of
sharing one (`authMode: "personal"`, set in the admin console). A key acts as
its owner: on such a connection `pull`, `deploy`, `rollback` and `compare`
run as the owner's account, and answer `409 PERSONAL_CREDENTIALS_REQUIRED`
until the owner has given one — in the app, or with
`PUT /api/v1/connections/:id/credentials`. `monitoring/check` is the
exception: like the watch itself it reads with the connection's service
account, whoever asks. The three `credentials` routes take the connection's
id alone and are open to those who use it: instance administrators and the
administrators of a project it is attached to (anyone else gets
`404 CONNECTION_NOT_FOUND`). A key restricted to one project works only on a
connection attached to that project, and only if its owner administers that
project (`403 API_KEY_PROJECT_RESTRICTED` otherwise).

### Backups (instance-wide, global-admin-only)

| Method   | Path                              | Scope                | Notes                                                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/connections/:id/backups` | `connections:manage` | A connected database's backups, newest first: `{ backups, limits, usedBytes, schedule }`                                                                                                                                                                                                                                                     |
| `POST`   | `/api/v1/connections/:id/backups` | `connections:manage` | `{ tables?, note? }` — starts a backup of the whole database, or of the tables named, and answers `202 { backup }` at once. One per database at a time (`409 BACKUP_ALREADY_RUNNING`)                                                                                                                                                        |
| `GET`    | `/api/v1/backups/:id`             | `connections:manage` | One backup (`{ backup }`): poll it until `status` leaves `running` for `done`, `failed` (see `error`) or `cancelled`; `tables.length` of `tablesTotal` is how far it is                                                                                                                                                                      |
| `POST`   | `/api/v1/backups/:id/cancel`      | `connections:manage` | Cancels a running backup; `409 BACKUP_NOT_READY` when it is not running                                                                                                                                                                                                                                                                      |
| `DELETE` | `/api/v1/backups/:id`             | `connections:manage` | Deletes the backup and its file; `409 BACKUP_NOT_READY` while it runs — cancel it first                                                                                                                                                                                                                                                      |
| `GET`    | `/api/v1/backups/:id/download`    | `connections:manage` | The decrypted file, `application/gzip`: one JSON document per line (a header, then per table a `{ table, columns }` line, its rows as arrays, an `{ end, rows }` line). `409 BACKUP_NOT_READY` unless `done`. Restoring is deliberately not part of `/api/v1`: it empties tables, and is done in the app, where the target's name is retyped |

`:id` of a connection is the one `GET /api/v1/projects/:id/connections`
lists. A backup is every row of the database in one file, so these need an
instance administrator's key — a project administrator's is refused
(`403 ADMIN_REQUIRED`) — and, like the team routes, refuse a key restricted
to one project. The schedule and the pin are set in the app.

### Teams (instance-wide, global-admin-only)

| Method   | Path                                | Scope          | Notes                                         |
| -------- | ----------------------------------- | -------------- | --------------------------------------------- |
| `GET`    | `/api/v1/teams`                     | `teams:manage` | Every team, with member count                 |
| `GET`    | `/api/v1/teams/:id`                 | `teams:manage` | Team detail with member list                  |
| `POST`   | `/api/v1/teams`                     | `teams:manage` | `{ name }` — create a team                    |
| `PATCH`  | `/api/v1/teams/:id`                 | `teams:manage` | `{ name }` — rename                           |
| `DELETE` | `/api/v1/teams/:id`                 | `teams:manage` | Also drops every project grant this team held |
| `POST`   | `/api/v1/teams/:id/members`         | `teams:manage` | `{ userId }` — add a member                   |
| `DELETE` | `/api/v1/teams/:id/members/:userId` | `teams:manage` | Remove a member                               |

## OpenAPI

`GET /api/v1/openapi.json` returns an OpenAPI 3.1 description of every route
above — public, no key needed — for Postman, Swagger UI, Insomnia or a client
generator (`npx @openapitools/openapi-generator-cli generate -i
https://your-instance/api/v1/openapi.json -g typescript-fetch -o client/`).
Each operation carries its required scope as `x-athanordb-scope`, and every
error response documents the stable `code` values. `servers` is filled in
when `ATHANORDB_PUBLIC_URL` is set.

The tables on this page, the OpenAPI document and the routes actually
registered are checked against each other by
`apps/server/src/modules/publicApi/openapi.test.ts` — a route added to one and
not the others fails the build.

## Example

```bash
KEY="adb_..."
PROJECT="proj_..."

# Pull the current schema as DBML
curl -H "Authorization: Bearer $KEY" \
  "https://your-instance/api/v1/projects/$PROJECT/export/dbml"

# Push an edit
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"source": "Table users {\n  id int [pk]\n}"}' \
  "https://your-instance/api/v1/projects/$PROJECT/import"

# Trigger a deployment
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{}' \
  "https://your-instance/api/v1/projects/$PROJECT/connections/$CONN_ID/deploy"
```

### In a CI job

A job that deploys the schema only when it is safe to: it stops if the
linter reports errors, stops if a database of the project was changed outside
the schema, then deploys. `curl` (7.76 or later, for `--fail-with-body`) and
`jq` are all it needs.

The key belongs to a project `administrator` and carries `projects:read`
(lint, check) and `deployments:trigger` (deploy); restrict it to the project.

```bash
#!/usr/bin/env bash
# ci/athanor-deploy.sh
set -euo pipefail

: "${ATHANOR_URL:?}" "${ATHANOR_KEY:?}" "${PROJECT:?}" "${CONN_ID:?}"
CONN_NAME="${CONN_NAME:-}"     # the connection's name: needed on the production stage
RESOLUTIONS="${RESOLUTIONS:-}" # answers to the risks of this deployment (JSON), see below
[ -n "$RESOLUTIONS" ] || RESOLUTIONS='{}'
API="$ATHANOR_URL/api/v1/projects/$PROJECT"

# Prints the answer; on an error status, prints it ({ error, code, ... }) to stderr and fails.
call() {
  local body
  if ! body=$(curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer $ATHANOR_KEY" "$@"); then
    echo "$body" >&2
    return 1
  fi
  printf '%s' "$body"
}

# 1. The schema against the project's own lint rules.
lint=$(call "$API/lint")
if [ "$(jq '.summary.error' <<<"$lint")" -gt 0 ]; then
  jq -r '.findings[] | select(.severity == "error") | "lint: \(.tableName): \(.message)"' <<<"$lint" >&2
  exit 1
fi

# 2. The project's databases against what was last deployed to them.
check=$(call -X POST "$API/monitoring/check")
if [ "$(jq '.result.unreachable' <<<"$check")" -gt 0 ]; then
  echo "a database could not be read: nothing is known about it" >&2
  exit 1
fi
# result.changes counts what this check found for the first time; a change
# already reported stays in events, open, until it is settled.
drift=$(jq '.result.changes + ([.events[] | select(.status == "open" and .kind != "unreachable")] | length)' <<<"$check")
if [ "$drift" -gt 0 ]; then
  jq -r '.events[] | select(.status == "open") | "changed outside the schema: \(.connectionName) (\(.kind))"' <<<"$check" >&2
  exit 1
fi

# 3. Deploy.
body=$(jq -n --arg name "$CONN_NAME" --argjson resolutions "$RESOLUTIONS" \
  '{ confirmName: $name, resolutions: $resolutions }')
call -X POST -H "Content-Type: application/json" -d "$body" \
  "$API/connections/$CONN_ID/deploy" | jq '{ success, executedStatements, backupId }'
```

The same as a GitHub Actions job, the key and the ids kept as repository
secrets and variables:

```yaml
jobs:
  deploy-schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint, check and deploy the schema
        env:
          ATHANOR_URL: https://your-instance
          ATHANOR_KEY: ${{ secrets.ATHANOR_KEY }}
          PROJECT: ${{ vars.ATHANOR_PROJECT }}
          CONN_ID: ${{ vars.ATHANOR_CONNECTION }}
          CONN_NAME: Production
        run: bash ci/athanor-deploy.sh
```

What the deployment step meets on its way:

- **`confirmName`** is the connection's name, as `GET
/api/v1/projects/:id/connections` lists it. On the production stage the
  deployment is refused without it (`409 PRODUCTION_CONFIRMATION_REQUIRED`);
  elsewhere it is not looked at.
- **`resolutions`** answers the changes that lose or reject data, one entry
  per risk: `{ "column:users.legacy_code": { "strategy": "DROP_DATA_CONFIRMED" } }`,
  `{ "column:users.country": { "strategy": "BACKFILL_DEFAULT", "value": "FR" } }`
  (keys are lower-case: `table:<table>` or `column:<table>.<column>`). Away
  from production a risk left unanswered takes its default — a dropped column
  that holds data is kept in the database. On the production stage a critical
  risk needs its answer: the deployment is refused with
  `409 DESTRUCTIVE_CHANGE_UNRESOLVED` and the list of `risks` to answer, so a
  job never loses data nobody decided to lose. Set `RESOLUTIONS` for that one
  run, once someone has decided.
- On the production stage the database is **backed up first** (`backupId` in
  the answer; `502 BACKUP_FAILED` and nothing deployed when the backup does
  not complete), and a stage that is not `free` wants the stage before it to
  have this schema already (`409 PIPELINE_STAGE_SKIPPED`): run the job on that
  stage's connection first.
- When the connection asks each user for **their own database account**, the
  deployment runs as the account of the key's owner, and is refused with
  `409 PERSONAL_CREDENTIALS_REQUIRED` until the owner has given one. Once, in
  the app or with a key that carries `connections:manage`:

  ```bash
  curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"username": "ci_deployer", "password": "..."}' \
    "https://your-instance/api/v1/connections/$CONN_ID/credentials"
  ```

  The check of step 2 is not concerned: like the watch, it reads with the
  connection's service account.

- The check only reads the databases it has a reference for — those the
  project has deployed to or pulled from at least once (`result.checked` says
  how many).
- A project can refuse by itself to deploy a schema with lint errors
  (`409 LINT_BLOCKS_DEPLOYMENT`); step 1 stops the job either way.

## Rate limits

`/api/v1` routes carry their own per-route limits (120 requests/minute for
reads, writes, connections, teams and IAM; 10/minute for the deploy and
rollback triggers — both execute real SQL against a real database — and for
starting or downloading a backup, every row of a database, and for giving a
personal database account, which tries it on the database), on top of the
app's global ceiling.

Independently of who calls, each **target database** (same engine, host,
port and database — or the same SQLite file) accepts at most 30 connection
operations (test, pull, plan, deploy, rollback) and 5 executed migrations or
rollbacks per minute, across the web UI and every API key. Past that the
server answers `429` with code `CONNECTION_RATE_LIMITED` and a
`retryAfterSeconds` hint; nothing is executed or recorded.

## Not yet built

- **Per-key usage quotas** beyond the shared route-level rate limit.
- **Multi-project key scoping** — a key is either unrestricted or locked to
  exactly one project, not a list.
- **Structured canvas-style edits** (set one table's position/color without
  writing DBML text) — today that's only reachable via the visual-metadata
  sidecar inside a DBML import, not a dedicated JSON field-level endpoint.
