# Public API (`/api/v1`)

A stable, versioned REST surface for scripts, CI pipelines and other tools —
separate from the internal `/api/*` routes the web app itself uses (those
stay cookie-session-only and are not a stable contract).

## Authentication

Create a key in **Settings → Billing → API keys**, or via the session-authed
management endpoints below. Every `/api/v1` request needs it:

```
Authorization: Bearer adb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The key authenticates **as the user who created it** — it can do anything
that user's own project permissions allow, narrowed by whatever scopes and
project restriction you gave it at creation time. Only a SHA-256 hash of the
key is ever stored; the full value is shown once, at creation, and cannot be
retrieved again — treat a lost key as gone and issue a new one.

### Scopes

| Scope | Grants |
|---|---|
| `projects:read` | List/read projects, export DBML/SQL/SVG/PNG, schema history, IAM, deployment history |
| `projects:write` | Create/rename/archive/delete a project, import/edit its schema, IAM grant/revoke |
| `deployments:trigger` | Run a deployment or rollback against a connected database |
| `connections:manage` | Create/update/delete/test a database connection, pull a live schema onto the canvas |
| `teams:manage` | Create/rename/delete a team, add/remove its members — instance-wide, global-admin-only |

A key with no matching scope gets `403 API_SCOPE_INSUFFICIENT`, not a silent
downgrade. A key created with a specific `projectId` only works against that
one project (`403 API_KEY_PROJECT_RESTRICTED` against any other) — omit it
for a key that should follow whatever projects its owner can see. Team
routes are instance-wide, not project-scoped — a project-restricted key is
refused outright (`403 API_KEY_PROJECT_RESTRICTED`) rather than let through
unscoped.

### Key management (session-only)

These are reachable from a browser session but **not** from another API
key — a key that could mint or revoke keys would let one leaked key
escalate into every key its owner has.

| Method | Path | Body |
|---|---|---|
| `GET` | `/api/keys` | — |
| `POST` | `/api/keys` | `{ name, scopes: ApiKeyScope[], projectId? }` |
| `DELETE` | `/api/keys/:id` | — |

## Endpoints

All project routes take a permission check identical to the web app's own
(`view` for reads, `edit` for the import, project `administrator` for
deploy/rollback/IAM/delete) — a scope only ever narrows what the key can do
on top of that, it never grants more than the underlying user already has.
"(+ admin)" below means the caller also needs project `administrator`, the
same elevated permission the equivalent internal route requires — a scope
alone is never enough for these.

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/v1/projects` | `projects:read` | Every project the caller can see, with their permission level |
| `POST` | `/api/v1/projects` | `projects:write` | `{ name }` — create a new, empty project |
| `GET` | `/api/v1/projects/:id` | `projects:read` | |
| `PATCH` | `/api/v1/projects/:id` | `projects:write` (+ admin) | `{ name?, status? }` — rename and/or archive/trash/restore |
| `DELETE` | `/api/v1/projects/:id` | `projects:write` (+ admin) | Permanent delete — irreversible |
| `GET` | `/api/v1/projects/:id/history` | `projects:read` | Schema revision log (Yjs update history), same as the app's history panel |
| `GET` | `/api/v1/projects/:id/iam` | `projects:read` | Teams granted access to this project and their permission level |
| `PUT` | `/api/v1/projects/:id/iam/:teamId` | `projects:write` (+ admin) | `{ permission: "view"\|"edit"\|"administrator" }` — grant or change a team's access |
| `DELETE` | `/api/v1/projects/:id/iam/:teamId` | `projects:write` (+ admin) | Revoke a team's access |
| `GET` | `/api/v1/projects/:id/export/dbml?visual=1` | `projects:read` | `visual=1` includes the position/style sidecar so a re-import is lossless |
| `GET` | `/api/v1/projects/:id/export/sql?dialect=postgres\|mysql\|mssql` | `projects:read` | |
| `GET` | `/api/v1/projects/:id/export/svg` | `projects:read` | Server-rendered from the schema's stored layout — a fast, simple diagram, not a pixel-perfect copy of the app's own canvas export |
| `GET` | `/api/v1/projects/:id/export/png` | `projects:read` | The same SVG, rasterised (`sharp`) |
| `POST` | `/api/v1/projects/:id/import` | `projects:write` | `{ source, dialect?, baseline? }` — same three-way merge (`baseline`) the DBML panel uses to avoid clobbering a concurrent edit. Canvas-only changes (table position/color) can be pushed the same way, by importing DBML text carrying the `visual=1` sidecar |
### Connections

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/v1/projects/:id/connections` | `projects:read` | |
| `POST` | `/api/v1/projects/:id/connections` | `connections:manage` (+ admin) | `{ name, engine, ...credentials }` — create a connection |
| `PUT` | `/api/v1/projects/:id/connections/:connId` | `connections:manage` (+ admin) | Partial update — an omitted password is preserved, not cleared |
| `DELETE` | `/api/v1/projects/:id/connections/:connId` | `connections:manage` (+ admin) | |
| `POST` | `/api/v1/projects/:id/connections/test` | `connections:manage` (+ admin) | Tests a config without saving it |
| `POST` | `/api/v1/projects/:id/connections/:connId/pull` | `connections:manage` (+ admin) | Introspects the live database and merges it onto the canvas, preserving existing tables' ids/positions/styles by name match |
| `POST` | `/api/v1/projects/:id/connections/:connId/deploy` | `deployments:trigger` (+ admin) | `{ resolutions? }` — runs the identical introspect → diff → generate → execute → record pipeline as the app's own deploy button |
| `GET` | `/api/v1/projects/:id/connections/:connId/history` | `projects:read` (+ admin) | |
| `POST` | `/api/v1/projects/:id/connections/:connId/history/:historyId/rollback` | `deployments:trigger` (+ admin) | Re-runs the stored inverse SQL for a past deployment — refused if already rolled back, or if none was generated |

All connection routes but `GET` (list) require project `administrator` —
they open a connection to a host/file the caller supplies, or execute
generated SQL against it, a materially larger blast radius than a plain
schema edit.

### Teams (instance-wide, global-admin-only)

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/v1/teams` | `teams:manage` | Every team, with member count |
| `GET` | `/api/v1/teams/:id` | `teams:manage` | Team detail with member list |
| `POST` | `/api/v1/teams` | `teams:manage` | `{ name }` — create a team |
| `PATCH` | `/api/v1/teams/:id` | `teams:manage` | `{ name }` — rename |
| `DELETE` | `/api/v1/teams/:id` | `teams:manage` | Also drops every project grant this team held |
| `POST` | `/api/v1/teams/:id/members` | `teams:manage` | `{ userId }` — add a member |
| `DELETE` | `/api/v1/teams/:id/members/:userId` | `teams:manage` | Remove a member |

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

## Rate limits

`/api/v1` routes carry their own per-route limits (120 requests/minute for
reads, writes, connections, teams and IAM; 10/minute for the deploy and
rollback triggers — both execute real SQL against a real database), on top
of the app's global ceiling.

## Not yet built

- **OpenAPI schema** — this table is hand-maintained for now; generating it
  from Fastify's route schemas (`@fastify/swagger`) is a separate follow-up.
- **Per-key usage quotas** beyond the shared route-level rate limit.
- **Multi-project key scoping** — a key is either unrestricted or locked to
  exactly one project, not a list.
- **Structured canvas-style edits** (set one table's position/color without
  writing DBML text) — today that's only reachable via the visual-metadata
  sidecar inside a DBML import, not a dedicated JSON field-level endpoint.
