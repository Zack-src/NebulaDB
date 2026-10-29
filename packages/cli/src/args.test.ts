import { test } from "node:test";
import assert from "node:assert/strict";
import { helpText, parseCommandLine, UsageError, COMMANDS } from "./args.js";
import { isLocalHost, resolveConfig } from "./config.js";

test("a command is selected by its words, the rest are positionals and options", () => {
  const parsed = parseCommandLine([
    "deploy",
    "run",
    "proj_1",
    "conn_2",
    "--confirm-name",
    "Shop live",
    "--no-backup",
    "--json",
  ]);
  assert.equal(parsed.kind, "run");
  if (parsed.kind !== "run") return;
  assert.equal(parsed.command.id, "deploy.run");
  assert.deepEqual(parsed.positionals, ["proj_1", "conn_2"]);
  assert.equal(parsed.values["confirm-name"], "Shop live");
  assert.equal(parsed.values["no-backup"], true);
  assert.equal(parsed.values.json, true);
});

test("options may come before or after the positionals, and -o is --output", () => {
  const parsed = parseCommandLine(["project", "export", "-o", "out.dbml", "proj_1", "--format=bundle"]);
  assert.equal(parsed.kind, "run");
  if (parsed.kind !== "run") return;
  assert.deepEqual(parsed.positionals, ["proj_1"]);
  assert.equal(parsed.values.output, "out.dbml");
  assert.equal(parsed.values.format, "bundle");
});

test("help and version, for the tool and for a command", () => {
  assert.deepEqual(parseCommandLine([]), { kind: "help", command: null });
  assert.deepEqual(parseCommandLine(["--help"]), { kind: "help", command: null });
  assert.deepEqual(parseCommandLine(["--version"]), { kind: "version" });
  const forLint = parseCommandLine(["lint", "--help"]);
  assert.equal(forLint.kind, "help");
  assert.match(helpText(COMMANDS.find((command) => command.id === "lint")!), /--fail-on <error\|warning>/);
  assert.match(helpText(null), /Exit codes:/);
});

test("every mistake is a usage error naming what is wrong", () => {
  const cases: [string[], RegExp][] = [
    [["frobnicate"], /unknown command "frobnicate"/],
    [["deploy", "nope"], /unknown command "deploy nope"/],
    [["lint"], /missing <projectId>/],
    [["lint", "a", "b"], /unexpected argument "b"/],
    [["lint", "a", "--nope"], /Unknown option '--nope'/],
    [["lint", "a", "--fail-on", "fatal"], /--fail-on must be one of error, warning/],
    [["history", "export", "p", "c"], /--output is required/],
    [["project", "export", "p", "--format", "pdf"], /--format must be one of dbml, bundle/],
    [["--json"], /no command given/],
  ];
  for (const [argv, message] of cases) {
    assert.throws(
      () => parseCommandLine(argv),
      (err) => err instanceof UsageError && message.test(err.message),
      argv.join(" "),
    );
  }
});

test("an API key is never taken from the command line", () => {
  assert.throws(() => parseCommandLine(["lint", "p", "--api-key", "ndb_secret"]), /NEBULADB_API_KEY/);
  assert.throws(() => parseCommandLine(["lint", "p", "--api-key=ndb_secret"]), /NEBULADB_API_KEY/);
  assert.throws(() => parseCommandLine(["lint", "ndb_0123456789"]), /NEBULADB_API_KEY/);
});

test("config: the address from the flag wins over the environment, the key only comes from the environment", () => {
  const env = { NEBULADB_URL: "https://env.example.com", NEBULADB_API_KEY: "ndb_k" };
  assert.deepEqual(resolveConfig({ url: "https://flag.example.com/" }, env), {
    baseUrl: "https://flag.example.com",
    apiKey: "ndb_k",
  });
  assert.equal(resolveConfig({}, env).baseUrl, "https://env.example.com");
  assert.equal(resolveConfig({ url: "https://example.com/nebula/" }, env).baseUrl, "https://example.com/nebula");
  assert.throws(() => resolveConfig({}, { NEBULADB_API_KEY: "ndb_k" }), /no instance address/);
  assert.throws(() => resolveConfig({}, { NEBULADB_URL: "https://x.example.com" }), /no API key/);
});

test("config: http:// is for localhost only, unless --insecure", () => {
  const env = { NEBULADB_API_KEY: "ndb_k" };
  assert.equal(resolveConfig({ url: "http://localhost:3001" }, env).baseUrl, "http://localhost:3001");
  assert.equal(resolveConfig({ url: "http://127.0.0.1:3001" }, env).baseUrl, "http://127.0.0.1:3001");
  assert.equal(resolveConfig({ url: "http://[::1]:3001" }, env).baseUrl, "http://[::1]:3001");
  assert.throws(() => resolveConfig({ url: "http://nebula.example.com" }, env), /clear text to nebula\.example\.com/);
  assert.equal(
    resolveConfig({ url: "http://nebula.example.com", insecure: true }, env).baseUrl,
    "http://nebula.example.com",
  );
  assert.throws(() => resolveConfig({ url: "ftp://nebula.example.com" }, env), /must start with https/);
  assert.throws(() => resolveConfig({ url: "not a url" }, env), /is not an address/);
  assert.throws(() => resolveConfig({ url: "https://user:pass@nebula.example.com" }, env), /user name or password/);
  assert.ok(isLocalHost("app.localhost"));
  assert.ok(!isLocalHost("localhost.example.com"));
  assert.ok(!isLocalHost("127.0.0.1.example.com"));
});
