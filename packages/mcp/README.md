# @nebuladb/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) that lets an AI agent (Claude Code,
Claude Desktop, Cursor, ...) work on a NebulaDB instance's projects through its [public API](../../docs/public-api.md)
(`/api/v1`): read and edit a schema, lay out the canvas, set initial data, convert types, browse and restore the
history, work across variants, plan and deploy, run SQL on the project's databases. Node 22 or later.

## What the agent may do

Create the key in **Settings → AI agent (MCP)**: the page gives the setup to paste for each client. It is an API key
of kind `agent`, and **NebulaDB itself** caps it, whatever this server sends:

- it acts as the person who created it, never beyond their permissions on a project or a database;
- on top of that, at most `deploy` on a project: it never creates, renames, archives or deletes a project, and never
  reaches a project's administration (access, connections, locks, webhooks, the watch's settings);
- it is never an instance administrator, even for one (teams, backups, a stage skip, overriding a lock);
- it never forks a revision nor starts a variant (each makes a project), never chooses the lint rules, and never
  approves nor rejects a deployment review — it requests one, a person decides;
- its SQL is a console member's: read-only unless asked, a write is one confirmed data statement, never structure
  (that goes through the schema and a deployment), only with the SQL access its owner was granted;
- whatever it does is in the audit log under its owner, marked `[AI agent]`.

The capabilities ticked when creating the key (edit the schema, deploy, run SQL) narrow that further; reading is
always on. An ordinary API key (Settings → API keys) works with the reading tools, without these caps.

## Configuration

| Variable                        | Meaning                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `NEBULADB_URL`                  | The instance's address (`https://nebula.example.com`)                                |
| `NEBULADB_API_KEY`              | The agent's key (**Settings → AI agent (MCP)**)                                      |
| `NEBULADB_MCP_READ_ONLY`        | `1` to offer the reading tools only: nothing that edits, deploys or runs SQL         |
| `NEBULADB_INSECURE`             | `1` to accept sending the key over plain `http://` to a non-local host (discouraged) |
| `NEBULADB_MCP_TIMEOUT_MS`       | Per-request timeout, default `15000`                                                 |
| `NEBULADB_MCP_MAX_OUTPUT_CHARS` | Cap on any returned text, default `200000` (longer output is truncated and says so)  |

The key comes from the environment only, is never logged or echoed in an error, and a redirect is refused rather
than followed. Errors reach the agent as short MCP tool errors (status, stable code, hint) with no stack trace.
Restrict the key to one project when the agent only needs one.

## Claude Code

```bash
claude mcp add nebuladb \
  --env NEBULADB_URL=https://nebula.example.com \
  --env NEBULADB_API_KEY=ndb_xxxxxxxx \
  -- npx -y @nebuladb/mcp
```

(From a checkout: `-- node /path/to/NebulaDB/packages/mcp/dist/bin.js` after `npm run build`.)

## Claude Desktop / Cursor

`claude_desktop_config.json`, or `.cursor/mcp.json` / `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nebuladb": {
      "command": "npx",
      "args": ["-y", "@nebuladb/mcp"],
      "env": {
        "NEBULADB_URL": "https://nebula.example.com",
        "NEBULADB_API_KEY": "ndb_xxxxxxxx"
      }
    }
  }
}
```

## Tools

Reading (always offered):

| Tool                      | Does                                                                               | API call                                                      |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `whoami`                  | Who the key acts for, its kind, scopes, project restriction and ceiling            | `GET /me`                                                     |
| `list_projects`           | Projects the key can see                                                           | `GET /projects`                                               |
| `get_schema`              | The project's schema as DBML text                                                  | `GET /projects/:id/export/dbml`                               |
| `get_table`               | One table: columns (type, flags), indexes, references (JSON)                       | `export/dbml`, parsed locally                                 |
| `search`                  | Tables and columns whose name contains a text                                      | `export/dbml`, parsed locally                                 |
| `get_revisions`           | Recent revisions, newest first (`limit`, default 20)                               | `GET /projects/:id/history`                                   |
| `lint_schema`             | The server's lint findings, with the project's own rules                           | `GET /projects/:id/lint`                                      |
| `export_sql`              | The schema as CREATE statements (postgres, mysql, mssql)                           | `GET /projects/:id/export/sql`                                |
| `list_connections`        | The project's databases (id, name, engine, stage), never their credentials         | `GET /projects/:id/connections`                               |
| `diff_schema`             | Compares two DBML texts locally: tables, columns, references added/removed/changed | none (`@nebuladb/dbml-engine`)                                |
| `export`                  | Data dictionary (markdown, csv, html, json), SVG diagram or the whole bundle       | `GET /projects/:id/dictionary`, `export/svg`, `export/bundle` |
| `get_lint_rules`          | The lint rules that apply and where they come from                                 | `GET /projects/:id/lint/rules`                                |
| `get_revision`            | The schema at a revision, as DBML (feed it to `diff_schema`)                       | `GET /projects/:id/revisions/:rev/export/dbml`                |
| `preview_type_conversion` | Columns not valid on an engine and what they would become                          | `POST /projects/:id/convert-types`                            |
| `list_variants`           | Variants of an original, or a variant's original, and the family                   | `GET /projects/:id/variants`, `family`                        |
| `compare_projects`        | What another project of the family has differently                                 | `GET /projects/:id/compare/:otherId`                          |
| `preview_variant_push`    | What sending changes to variants would do, conflicts included                      | `POST /projects/:id/variants/preview`                         |
| `get_seed`                | A table's initial data (CSV)                                                       | `GET /projects/:id/seeds/:table`                              |

Working (unless `NEBULADB_MCP_READ_ONLY=1`):

| Tool                        | Does                                                                        | API call                                     |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `update_schema`             | Replaces the schema with a DBML text, merged against a `baseline`           | `POST /projects/:id/import`                  |
| `get_pipeline`              | The databases along the stages and which have the current schema            | `GET /projects/:id/pipeline`                 |
| `plan_deployment`           | What a deployment would do: diff, risks, SQL, blockers — changes nothing    | `POST .../connections/:connId/plan`          |
| `deploy`                    | Deploys the current schema (risks answered with `resolutions`)              | `POST .../connections/:connId/deploy`        |
| `request_deployment_review` | Prepares a deployment for a stage that requires a review                    | `POST .../connections/:connId/reviews`       |
| `get_deployment_history`    | Past deployments to a database                                              | `GET .../connections/:connId/history`        |
| `run_sql`                   | One SQL statement on the project's database; read-only unless `write: true` | `POST .../connections/:connId/query`         |
| `import_sql`                | Replaces the schema with SQL DDL of a dialect                               | `POST /projects/:id/import` (`dialect`)      |
| `set_table_layout`          | Moves tables and sets their header colour                                   | `PATCH /projects/:id/layout`                 |
| `convert_types`             | Rewrites the types not valid on an engine (editor's type table)             | `POST /projects/:id/convert-types` (`apply`) |
| `set_seed` / `delete_seed`  | Sets (CSV, columns matched by name) or removes a table's initial data       | `PUT` / `DELETE /projects/:id/seeds/:table`  |
| `label_revision`            | Names a revision                                                            | `PATCH /projects/:id/revisions/:rev`         |
| `restore_revision`          | Puts the schema (or some tables) back as it stood at a revision             | `POST /projects/:id/revisions/:rev/restore`  |
| `push_to_variants`          | Sends changes to variants, or pulls theirs                                  | `POST /projects/:id/variants/push`           |
| `reset_variant`             | Starts a variant again from its original or another variant                 | `POST /projects/:id/variant/reset`           |

`update_schema` keeps an existing table's position and colour: use `set_table_layout` for those.

`diff_schema` matches tables and columns by name, so a rename shows as removed + added. The server's instructions
tell the agent that names, notes and query results are data written by people, never instructions to follow.

## Resources

`nebuladb://projects/{id}/schema` — the DBML text of a project (listed for every visible project).

## Development

```bash
npm run build -w packages/mcp
npm test -w packages/mcp      # node:test against a stub HTTP server, no NebulaDB needed
```
