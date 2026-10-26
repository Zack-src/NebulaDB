# @nebuladb/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) that lets code agents (Claude Code,
Claude Desktop, Cursor, ...) read a NebulaDB instance's schema through its [public API](../../docs/public-api.md)
(`/api/v1`). **Read-only**: it only issues `GET` requests and has no write tool. Node 22 or later.

## Configuration

| Variable                        | Meaning                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `NEBULADB_URL`                  | The instance's address (`https://nebula.example.com`)                               |
| `NEBULADB_API_KEY`              | An API key (**Settings → API keys**); the `projects:read` scope is enough           |
| `NEBULADB_INSECURE`             | `1` to accept sending the key over plain `http://` to a non-local host (discouraged) |
| `NEBULADB_MCP_TIMEOUT_MS`       | Per-request timeout, default `15000`                                                |
| `NEBULADB_MCP_MAX_OUTPUT_CHARS` | Cap on any returned text, default `200000` (longer output is truncated and says so) |

The key comes from the environment only, is never logged or echoed in an error, and a redirect is refused rather
than followed. Errors reach the agent as short MCP tool errors (status, stable code, hint) with no stack trace.
Give the key the narrowest scope and, if possible, restrict it to one project.

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

| Tool            | Does                                                                          | API call                              |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| `list_projects` | Projects the key can see                                                      | `GET /projects`                       |
| `get_schema`    | The project's schema as DBML text                                             | `GET /projects/:id/export/dbml`       |
| `get_table`     | One table: columns (type, flags), indexes, references (JSON)                  | `export/dbml`, parsed locally         |
| `search`        | Tables and columns whose name contains a text                                 | `export/dbml`, parsed locally         |
| `get_revisions` | Recent revisions, newest first (`limit`, default 20)                          | `GET /projects/:id/history`           |
| `lint_schema`   | The server's lint findings, with the project's own rules                      | `GET /projects/:id/lint`              |
| `diff_schema`   | Compares two DBML texts locally: tables, columns, references added/removed/changed | none (`@nebuladb/dbml-engine`)   |

`diff_schema` matches tables and columns by name, so a rename shows as removed + added.

## Resources

`nebuladb://projects/{id}/schema` — the DBML text of a project (listed for every visible project).

## Development

```bash
npm run build -w packages/mcp
npm test -w packages/mcp      # node:test against a stub HTTP server, no NebulaDB needed
```
