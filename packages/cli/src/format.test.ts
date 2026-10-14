import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./client.js";
import {
  formatApiError,
  formatDrift,
  formatLint,
  formatPlan,
  formatProjects,
  formatReviews,
  riskKey,
  table,
  type PlanRisk,
} from "./format.js";

test("a table pads its columns but not the last one", () => {
  assert.equal(table(["A", "BB"], [["xxx", "y"]]), "A    BB\nxxx  y");
});

test("projects: a list, or a sentence when there are none", () => {
  assert.equal(formatProjects([]), "No projects.");
  assert.equal(
    formatProjects([{ id: "p1", name: "Shop", permission: "administrator" }]),
    "ID  NAME  PERMISSION\np1  Shop  administrator",
  );
});

test("lint: one line per finding, then the verdict", () => {
  const text = formatLint(
    {
      profile: "standard",
      blockDeployment: false,
      summary: { error: 1, warning: 0, info: 2 },
      findings: [
        { ruleId: "no-primary-key", severity: "error", tableName: "users", message: "has no primary key" },
        { ruleId: "naming", severity: "info", tableName: "users", fieldName: "ID", message: "use snake_case" },
      ],
    },
    "error",
  );
  assert.equal(
    text,
    [
      "error   users: has no primary key [no-primary-key]",
      "info    users.ID: use snake_case [naming]",
      "",
      "1 error, 0 warnings, 2 info (profile standard, failing on error)",
    ].join("\n"),
  );
});

test("drift: new changes, then what is still open, unreachable ones apart", () => {
  const text = formatDrift({
    result: { checked: 2, changes: 1, unreachable: 1 },
    events: [
      {
        id: "e1",
        connectionName: "Staging",
        kind: "external",
        status: "open",
        added: ["audit"],
        removed: [],
        changed: ["users"],
        error: null,
      },
      {
        id: "e2",
        connectionName: "Prod",
        kind: "unreachable",
        status: "open",
        added: [],
        removed: [],
        changed: [],
        error: "ECONNREFUSED",
      },
      {
        id: "e3",
        connectionName: "Old",
        kind: "external",
        status: "resolved",
        added: ["x"],
        removed: [],
        changed: [],
        error: null,
      },
    ],
  });
  assert.equal(
    text,
    [
      "Checked 2 databases: 1 new change, 1 unreachable.",
      "  changed outside the schema: Staging (external): added audit; changed users",
      "  unreachable: Prod (ECONNREFUSED)",
    ].join("\n"),
  );
});

test("a plan: counts, risks under their resolution key, what would refuse it, then the SQL", () => {
  const risk: PlanRisk = {
    type: "DROP_COLUMN",
    severity: "critical",
    tableName: "Users",
    columnName: "Legacy",
    affectedRowCount: 12,
  };
  assert.equal(riskKey(risk), "column:users.legacy");
  assert.equal(riskKey({ ...risk, columnName: undefined }), "table:users");
  assert.equal(riskKey({ ...risk, resolutionKey: "column:a.b" }), "column:a.b");

  const text = formatPlan({
    engine: "postgres",
    diff: {
      tables: [
        { name: "a", status: "added" },
        { name: "b", status: "changed" },
      ],
    },
    risks: [risk],
    sqlPreview: "ALTER TABLE users DROP COLUMN legacy;\n",
    blockers: { lintErrors: 2, waitsForStage: "Staging" },
  });
  assert.match(text, /^Engine: postgres\nTables: 1 added, 1 changed, 0 removed\n/);
  assert.match(text, /critical column:users\.legacy {2}DROP_COLUMN {2}12 rows/);
  assert.match(text, /Would be refused: 2 lint errors/);
  assert.match(text, /Would be refused: the stage "Staging" must have this schema first/);
  assert.ok(text.endsWith("ALTER TABLE users DROP COLUMN legacy;"));
  assert.match(
    formatPlan({
      engine: "sqlite",
      diff: {},
      risks: [],
      sqlPreview: " ",
      blockers: { lintErrors: 0, waitsForStage: null },
    }),
    /-- nothing to deploy$/,
  );
});

test("reviews: one row each, the environment beside the database", () => {
  assert.equal(formatReviews([]), "No reviews.");
  const text = formatReviews([
    {
      id: "r1",
      connectionName: "Shop live",
      environment: "Production",
      status: "pending",
      requestedByEmail: "a@x.io",
      requestedAt: "2026-01-01T00:00:00Z",
    },
  ]);
  assert.match(text, /^r1\s+Shop live \(Production\)\s+pending\s+a@x\.io\s+2026-01-01T00:00:00Z$/m);
});

test("a server refusal keeps its code, its message and what it listed", () => {
  const error = new ApiError(409, {
    error: "this plan loses data",
    code: "DESTRUCTIVE_CHANGE_UNRESOLVED",
    environment: "Live",
    risks: [
      { type: "DROP_COLUMN", severity: "critical", tableName: "users", columnName: "legacy", affectedRowCount: 1 },
    ],
  });
  assert.equal(error.isAuth, false);
  assert.equal(
    formatApiError(error),
    [
      "this plan loses data (DESTRUCTIVE_CHANGE_UNRESOLVED)",
      "  environment: Live",
      "Risks to answer:",
      "  critical column:users.legacy  DROP_COLUMN",
    ].join("\n"),
  );
  assert.equal(new ApiError(401, { code: "AUTH_REQUIRED" }).isAuth, true);
  assert.equal(new ApiError(403, { code: "API_SCOPE_INSUFFICIENT" }).isAuth, true);
  assert.equal(new ApiError(403, { code: "FORBIDDEN" }).isAuth, false);
  assert.equal(new ApiError(502, {}).code, "HTTP_502");
});
