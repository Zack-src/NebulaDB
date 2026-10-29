import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConfigError, resolveConfig, type Config } from "./config.js";
import { createServer } from "./server.js";

const KEY = "ndb_secretsecretsecretsecretsecretsecret";
const DBML = `Table users {
  id int [pk, increment]
  email varchar [unique, not null]
}

Table posts {
  id int [pk]
  user_id int [not null]
  title varchar
  indexes {
    (user_id, title) [name: 'idx_posts_user']
  }
}

Ref: posts.user_id > users.id [delete: cascade]
`;

const seen: { url: string; method: string; auth?: string }[] = [];
let http: Server;
let baseUrl: string;

before(async () => {
  http = createHttpServer((req: IncomingMessage, res) => {
    seen.push({ url: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: "no", code: "UNAUTHORIZED" });
    switch (req.url) {
      case "/api/v1/projects":
        return json(200, { projects: [{ id: "p1", name: "Shop", status: "active", permission: "edit" }] });
      case "/api/v1/projects/p1/export/dbml":
        res.writeHead(200, { "content-type": "text/plain" });
        return void res.end(DBML);
      case "/api/v1/projects/p1/history":
        return json(200, {
          revisions: [
            { id: "r1", author: "ann", label: "first", createdAt: "2026-01-01" },
            { id: "r2", author: "bob", label: null, createdAt: "2026-01-02" },
          ],
        });
      case "/api/v1/projects/p1/lint":
        return json(200, {
          profile: "default",
          summary: { error: 1, warning: 0, info: 0 },
          findings: [{ ruleId: "no-pk", severity: "error", tableName: "logs", message: "no primary key" }],
        });
      case "/api/v1/projects/forbidden/export/dbml":
        return json(403, { error: "stack at /srv/app.js:12", code: "API_SCOPE_INSUFFICIENT" });
      case "/api/v1/projects/boom/export/dbml":
        res.writeHead(500, { "content-type": "text/html" });
        return void res.end("<html>Error at /srv/secret/path.js</html>");
      case "/api/v1/projects/slow/export/dbml":
        return; // never answers
      default:
        return json(404, { error: "not found", code: "PROJECT_NOT_FOUND" });
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

after(() => {
  http.closeAllConnections();
  http.close();
});

async function connect(overrides: Partial<Config> = {}) {
  const config: Config = { baseUrl, apiKey: KEY, timeoutMs: 5000, maxOutputChars: 100_000, ...overrides };
  const server = createServer(config);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: result.content[0].text, isError: result.isError === true };
}

describe("tools", () => {
  it("lists exactly the read-only tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["diff_schema", "get_revisions", "get_schema", "get_table", "lint_schema", "list_projects", "search"],
    );
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  });

  it("list_projects sends the key and formats rows", async () => {
    const client = await connect();
    const r = await call(client, "list_projects");
    assert.match(r.text, /p1\tShop \(edit\)/);
    assert.equal(seen.at(-1)?.auth, `Bearer ${KEY}`);
    assert.equal(seen.at(-1)?.method, "GET");
  });

  it("get_schema returns the DBML", async () => {
    const r = await call(await connect(), "get_schema", { project_id: "p1" });
    assert.equal(r.text, DBML);
  });

  it("get_table describes columns, indexes and refs", async () => {
    const r = await call(await connect(), "get_table", { project_id: "p1", table: "Posts" });
    assert.equal(r.isError, false);
    const info = JSON.parse(r.text);
    assert.equal(info.name, "posts");
    assert.deepEqual(info.columns.map((c: { name: string }) => c.name), ["id", "user_id", "title"]);
    assert.deepEqual(info.indexes[0].columns, ["user_id", "title"]);
    assert.match(info.refs[0], /posts\.user_id > users\.id/);
  });

  it("get_table on an unknown table lists known ones", async () => {
    const r = await call(await connect(), "get_table", { project_id: "p1", table: "nope" });
    assert.equal(r.isError, true);
    assert.match(r.text, /known: users, posts/);
  });

  it("search finds tables and columns", async () => {
    const r = await call(await connect(), "search", { project_id: "p1", query: "user" });
    assert.match(r.text, /table {2}users/);
    assert.match(r.text, /column posts\.user_id/);
  });

  it("get_revisions is newest first", async () => {
    const r = await call(await connect(), "get_revisions", { project_id: "p1" });
    assert.ok(r.text.indexOf("r2") < r.text.indexOf("r1"));
  });

  it("lint_schema formats findings", async () => {
    const r = await call(await connect(), "lint_schema", { project_id: "p1" });
    assert.match(r.text, /error +logs: no primary key \[no-pk\]/);
    assert.match(r.text, /1 error\(s\)/);
  });

  it("diff_schema compares locally without calling the server", async () => {
    const before = seen.length;
    const after = DBML.replace("title varchar", "title text\n  slug varchar").replace("Table users {", "Table users {\n  age int");
    const r = await call(await connect(), "diff_schema", { before: DBML, after });
    assert.match(r.text, /~ table posts/);
    assert.match(r.text, /\+ slug varchar/);
    assert.match(r.text, /~ title: varchar -> text/);
    assert.match(r.text, /\+ age int/);
    assert.equal(seen.length, before);
    const same = await call(await connect(), "diff_schema", { before: DBML, after: DBML });
    assert.match(same.text, /No structural difference/);
  });

  it("diff_schema reports invalid DBML with a location", async () => {
    const r = await call(await connect(), "diff_schema", { before: "Table {", after: DBML });
    assert.equal(r.isError, true);
    assert.match(r.text, /invalid DBML/);
  });
});

describe("errors and limits", () => {
  it("maps API errors without leaking server detail beyond a short message, nor the key", async () => {
    const client = await connect();
    const r = await call(client, "get_schema", { project_id: "forbidden" });
    assert.equal(r.isError, true);
    assert.match(r.text, /403 API_SCOPE_INSUFFICIENT/);
    assert.ok(!r.text.includes(KEY));
  });

  it("does not echo a proxy's error page", async () => {
    const r = await call(await connect(), "get_schema", { project_id: "boom" });
    assert.equal(r.isError, true);
    assert.ok(!r.text.includes("secret/path"));
    assert.match(r.text, /500/);
  });

  it("maps a bad key to a clear message", async () => {
    const r = await call(await connect({ apiKey: "zzkeyzz" }), "list_projects");
    assert.equal(r.isError, true);
    assert.match(r.text, /401/);
    assert.ok(!r.text.includes("zzkeyzz"));
  });

  it("times out", async () => {
    const r = await call(await connect({ timeoutMs: 200 }), "get_schema", { project_id: "slow" });
    assert.equal(r.isError, true);
    assert.match(r.text, /did not answer in time/);
  });

  it("caps the output size", async () => {
    const r = await call(await connect({ maxOutputChars: 50 }), "get_schema", { project_id: "p1" });
    assert.ok(r.text.startsWith(DBML.slice(0, 50)));
    assert.match(r.text, /truncated/);
  });

  it("reports an unreachable server without the key", async () => {
    const r = await call(await connect({ baseUrl: "http://127.0.0.1:1" }), "list_projects");
    assert.equal(r.isError, true);
    assert.match(r.text, /cannot reach/);
    assert.ok(!r.text.includes(KEY));
  });
});

describe("resources", () => {
  it("lists and reads project schemas", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    assert.equal(resources[0].uri, "nebuladb://projects/p1/schema");
    const read = await client.readResource({ uri: "nebuladb://projects/p1/schema" });
    assert.equal((read.contents[0] as { text: string }).text, DBML);
  });
});

describe("config", () => {
  it("requires URL and key, with messages that never contain the key", () => {
    assert.throws(() => resolveConfig({}), ConfigError);
    assert.throws(() => resolveConfig({ NEBULADB_URL: "http://localhost:3000" }), /NEBULADB_API_KEY/);
  });

  it("refuses a clear-text key over the network unless opted in", () => {
    const env = { NEBULADB_URL: "http://nebula.example.com", NEBULADB_API_KEY: KEY };
    assert.throws(() => resolveConfig(env), (e: Error) => e instanceof ConfigError && !e.message.includes(KEY));
    assert.equal(resolveConfig({ ...env, NEBULADB_INSECURE: "1" }).baseUrl, "http://nebula.example.com");
    assert.equal(resolveConfig({ NEBULADB_URL: "http://localhost:3000/", NEBULADB_API_KEY: KEY }).baseUrl, "http://localhost:3000");
  });

  it("validates numeric limits", () => {
    assert.throws(() => resolveConfig({ NEBULADB_URL: "https://x.io", NEBULADB_API_KEY: KEY, NEBULADB_MCP_TIMEOUT_MS: "abc" }), ConfigError);
  });
});
