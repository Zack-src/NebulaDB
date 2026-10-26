# @nebuladb/cli

A command-line client for a NebulaDB instance's [public API](../../docs/public-api.md) (`/api/v1`): lint the
schema, check the databases for drift, plan and run deployments, export and import projects — from a terminal,
a script or a CI job, without writing HTTP calls by hand. It only speaks HTTP, so it works with any NebulaDB
instance whatever it stores its data in. Two commands, `lint <file.dbml>` and `diff`, work offline on DBML files
and need no instance at all. Node 22 or later.

```bash
npx @nebuladb/cli --help
# or, installed: npm install --global @nebuladb/cli && nebuladb --help
```

## Configuration

(Not needed by the [offline commands](#offline-lint-and-diff-of-dbml-files).)

| What     | How                                                             |
| -------- | --------------------------------------------------------------- |
| Instance | `--url https://nebula.example.com` or `NEBULADB_URL`            |
| API key  | `NEBULADB_API_KEY` only (create one in **Settings → API keys**) |

The key is read from the environment and nowhere else: there is no `--api-key` option and a key given as an
argument is refused, so it never shows in a process list or a shell history. The CLI never prints it (it is
also scrubbed from anything the server echoes back).

A plain `http://` address is refused unless the host is `localhost`, `*.localhost`, `127.0.0.0/8` or `::1`;
pass `--insecure` if you accept sending the key in clear text. Redirects are not followed, so a key is never
sent to a host other than the one you named.

The key needs the scopes of what you run: `projects:read` (lint, drift check, plan, exports, reviews),
`projects:write` (import) and `deployments:trigger` (deploy). It authenticates as the user who created it, so
that user needs `deploy` on the project for everything that touches a database.

## Commands

The command comes first, then its arguments and options (`nebuladb deploy run <projectId> <connectionId> …`).

| Command                                                 | What it does                                                              | Route                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `projects list`                                         | The projects the key can see                                              | `GET /projects`                                        |
| `project export <id>`                                   | DBML (default) or `--format bundle` to stdout, or `-o file`               | `GET /projects/:id/export/dbml\|bundle`                |
| `project import <id> <file>`                            | DBML or SQL (`--dialect`), or a bundle (a `{…}` JSON file, or `--format`) | `POST /projects/:id/import[/bundle]`                   |
| `lint <projectId>`                                      | The project's lint findings; `--fail-on warning` to fail on warnings      | `GET /projects/:id/lint`                               |
| `drift check <projectId>`                               | Reads the databases now; `--ignore-unreachable`                           | `POST /projects/:id/monitoring/check`                  |
| `deploy plan <projectId> <connectionId>`                | The diff, the risks, what would refuse it, the SQL — runs nothing         | `POST /projects/:id/connections/:connId/plan`          |
| `deploy run <projectId> <connectionId>`                 | Deploys; `--confirm-name`, `--resolutions file.json`, `--no-backup`       | `POST /projects/:id/connections/:connId/deploy`        |
| `history export <projectId> <connectionId> -o file.zip` | Migration files; `--format sql\|flyway\|liquibase`                        | `GET /projects/:id/connections/:connId/history/export` |
| `reviews list <projectId>`                              | The deployment reviews of the project                                     | `GET /projects/:id/reviews`                            |

Every command takes `--json` (the result as JSON on stdout instead of text) and `--json-file <path>` (a copy of
the JSON result in a file, while the text output stays). With `--json`, a failure is printed on stdout too, in
the server's own `{ "error", "code", … }` shape.

### Offline lint and diff of DBML files

These run entirely in the process, with the same DBML engine and default lint rules as the app. No instance
address and no API key are read and nothing touches the network, so they fit a pull request check.

```bash
nebuladb lint db/schema.dbml                      # file:line:column  severity  table.field: message [rule]
nebuladb lint db/schema.dbml --fail-on warning --format json
nebuladb diff old.dbml new.dbml                   # + added / - removed / ~ changed: tables, fields, refs
nebuladb diff old.dbml new.dbml --format markdown --exit-code
```

`lint <file>` is selected over `lint <projectId>` when the argument ends in `.dbml` or contains a path separator
(write `./schema` for a file without extension). Its `--format` is `text` (default), `json` or `markdown`, and
`--fail-on error|warning` works as for a project. `diff` matches tables and fields by name (a renamed table or
field shows as removed and added) and takes `--format text|json|markdown`.

| Exit | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 0    | Done: `lint` found nothing at or above `--fail-on`; `diff` always, unless `--exit-code` and files differ  |
| 1    | Findings at or above `--fail-on`, `diff --exit-code` found a difference, or a DBML syntax error (`file:line:col: message`) |
| 2    | Usage error, including a file that cannot be read                                                         |

The line and column of a finding are those of the table or field declaration in the file. The DBML engine is
loaded on demand, so the other commands start as fast as before.

### Lint and drift: gates for a pipeline

`lint` exits 1 when the schema has lint errors (warnings too with `--fail-on warning`). `drift check` exits 1
when a database changed outside the schema: a change found now, a change found earlier and still open, or a
database that could not be read (unless `--ignore-unreachable`) — nothing is known about that database, so it
is not taken for a clean one.

### Deploying

`deploy run` sends what you ask and nothing more, and prints the server's answer. It **never answers a risk for
you**: a risk gets an answer only from the `--resolutions` file you pass, in the server's format —

```json
{
  "column:users.legacy_code": { "strategy": "DROP_DATA_CONFIRMED" },
  "column:users.country": { "strategy": "BACKFILL_DEFAULT", "value": "FR" }
}
```

— and `deploy plan` lists the keys to answer. Every refusal of the server is printed with its stable code and
exits 1; the usual ones:

| Code                               | Meaning                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `PRODUCTION_CONFIRMATION_REQUIRED` | Pass `--confirm-name` with the connection's exact name                          |
| `DESTRUCTIVE_CHANGE_UNRESOLVED`    | A critical risk on the production stage has no answer; the risks are listed     |
| `LINT_BLOCKS_DEPLOYMENT`           | The project refuses to deploy a schema with lint errors                         |
| `PIPELINE_STAGE_SKIPPED`           | The stage before this one does not have the schema yet; deploy there first      |
| `DEPLOYMENT_REVIEW_REQUIRED`       | The stage asks for a review: request and approve one in the app, then deploy it |
| `BACKUP_FAILED`                    | The backup before a production deployment failed; nothing was deployed          |

`--no-backup` asks the server not to back up first; it may still refuse (the production stage insists).

## Exit codes

| Code | Meaning                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| 0    | Done; the check found nothing                                                                   |
| 1    | The server refused the request, or a check found something (lint errors, drift, a blocked plan) |
| 2    | Usage error: unknown command or option, missing argument, no address or key, refused address    |
| 3    | The instance could not be reached, or the key was not accepted (`401`, wrong scope or project)  |

## In CI

See [the GitHub Action](../../actions/nebuladb/README.md) and the example workflow in
[`docs/public-api.md`](../../docs/public-api.md#in-a-ci-job). Any other CI runs the same commands:

```bash
export NEBULADB_URL=https://nebula.example.com NEBULADB_API_KEY="$SECRET"
npx @nebuladb/cli lint "$PROJECT"
npx @nebuladb/cli drift check "$PROJECT"
npx @nebuladb/cli deploy run "$PROJECT" "$CONNECTION" --confirm-name "Shop live"
```

## Development

```bash
npm run build -w packages/cli
npm test -w packages/cli     # the integration test boots apps/server, so build it first
```
