import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "@athanordb/shared";
import {
  DEFAULT_LINT_SETTINGS,
  applyLintFix,
  lintProject,
  parseLintSettings,
  resolveLintLevels,
  summarizeLint,
  type LintSettings,
} from "./lint.js";

function field(id: string, name: string, type = "integer", extra: Partial<Field> = {}): Field {
  return { id, name, type, ...extra };
}

function table(id: string, name: string, fields: Field[], extra: Partial<Table> = {}): Table {
  return { id, name, fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "standard", ...extra };
}

/** A table no standard rule has anything to say about. */
function cleanTable(id: string, name: string, extraFields: Field[] = []): Table {
  return table(
    id,
    name,
    [
      field(`${id}-id`, "id", "integer", { pk: true }),
      ...extraFields,
      field(`${id}-c`, "created_at", "timestamp"),
      field(`${id}-u`, "updated_at", "timestamp"),
    ],
    { note: `The ${name}.` },
  );
}

function project(tables: Table[], refs: Ref[] = []): Project {
  return { id: "p1", name: "Test", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

function fk(id: string, from: [string, string], to: [string, string]): Ref {
  return {
    id,
    from: { tableId: from[0], fieldId: from[1] },
    to: { tableId: to[0], fieldId: to[1] },
    cardinality: "one-to-many",
  };
}

const settings = (patch: Partial<LintSettings>): LintSettings => ({ ...DEFAULT_LINT_SETTINGS, ...patch });
const rulesOf = (p: Project, s?: LintSettings) => lintProject(p, s).map((f) => f.ruleId);
let counter = 0;
const newId = () => `new-${++counter}`;

test("a schema that follows every convention has no finding", () => {
  const users = cleanTable("t1", "users");
  const posts = cleanTable("t2", "posts", [field("t2-user", "user_id")]);
  posts.indexes.push({ id: "i1", fieldIds: ["t2-user"] });
  assert.deepEqual(lintProject(project([users, posts], [fk("r1", ["t2", "t2-user"], ["t1", "t1-id"])])), []);
});

test("each built-in rule reports what it is for", () => {
  const users = cleanTable("t1", "users");
  const bad = table("t2", "OrderLines", [
    field("f1", "userId"),
    field("f2", "label", "varchar"),
    field("f3", "total_price", "float"),
    field("f4", "ratio", "float"),
    field("f5", "code", "varchar(12)"),
  ]);
  const findings = lintProject(project([users, bad], [fk("r1", ["t2", "f1"], ["t1", "t1-id"])]));
  const of = (ruleId: string) => findings.filter((f) => f.ruleId === ruleId);

  assert.equal(of("pk-required").length, 1);
  assert.equal(of("pk-required")[0].fixable, true);
  assert.deepEqual(
    of("fk-indexed").map((f) => f.fieldName),
    ["userId"],
  );
  // The table name and the one camelCase column — not the snake_case ones.
  assert.deepEqual(
    of("naming-snake-case").map((f) => f.fieldName ?? f.tableName),
    ["OrderLines", "userId"],
  );
  assert.deepEqual(
    of("varchar-length").map((f) => f.fieldName),
    ["label"],
  );
  // A float is only a problem on a column that looks like an amount.
  assert.deepEqual(
    of("no-float-money").map((f) => f.fieldName),
    ["total_price"],
  );
  assert.equal(of("timestamps")[0].params.columns, "created_at, updated_at");
  assert.equal(of("table-description").length, 1);
  assert.ok(findings.every((f) => f.tableId === "t2"));
});

test("a composite key, a unique column and a leading index column all count", () => {
  const users = cleanTable("t1", "users");
  const link = cleanTable("t2", "links", [field("a", "user_id"), field("b", "owner_id", "integer", { unique: true })]);
  link.fields = link.fields.filter((f) => f.name !== "id");
  link.indexes = [{ id: "i1", fieldIds: ["a", "b"], pk: true }];
  const refs = [fk("r1", ["t2", "a"], ["t1", "t1-id"]), fk("r2", ["t2", "b"], ["t1", "t1-id"])];
  assert.deepEqual(rulesOf(project([users, link], refs)), []);

  // Second column of an index: a lookup on it alone cannot use the index.
  link.indexes = [{ id: "i1", fieldIds: ["c", "a"], pk: true }];
  assert.deepEqual(rulesOf(project([users, link], refs)), ["fk-indexed"]);
});

test("profiles change the level, overrides change one rule", () => {
  const bare = table("t1", "things", [field("f1", "name", "text")], { note: "Things." });
  const p = project([bare]);

  assert.deepEqual(rulesOf(p, settings({ profile: "relaxed" })), ["pk-required"]);
  assert.equal(lintProject(p, settings({ profile: "relaxed" }))[0].severity, "warning");

  const strict = lintProject(p, settings({ profile: "strict" }));
  assert.deepEqual(
    strict.map((f) => [f.ruleId, f.severity]),
    [
      ["pk-required", "error"],
      ["timestamps", "warning"],
      ["column-description", "info"],
    ],
  );
  assert.deepEqual(summarizeLint(strict), { error: 1, warning: 1, info: 1 });

  const custom = settings({ profile: "custom", rules: { "pk-required": "off", timestamps: "error" } });
  assert.equal(resolveLintLevels(custom)["fk-indexed"], "warning");
  assert.deepEqual(
    lintProject(p, custom).map((f) => [f.ruleId, f.severity]),
    [["timestamps", "error"]],
  );
});

test("a table is excepted by the settings or by its own note", () => {
  const a = table("t1", "alpha", [field("f1", "name", "text")], { note: "Alpha." });
  const b = table("t2", "beta", [field("f2", "name", "text")], { note: "Beta. lint-ignore: pk-required, timestamps" });
  const c = table("t3", "gamma", [field("f3", "name", "text")], { note: "lint-ignore: all" });
  const p = project([a, b, c]);

  // `gamma` has nothing but the annotation in its note: still excepted from
  // the description rule, since `all` covers it.
  assert.deepEqual(
    lintProject(p).map((f) => `${f.tableName}:${f.ruleId}`),
    ["alpha:pk-required", "alpha:timestamps"],
  );

  const ignores = [{ ruleId: "pk-required" as const, tableId: "t1", tableName: "alpha" }];
  assert.deepEqual(
    lintProject(p, settings({ ignores })).map((f) => `${f.tableName}:${f.ruleId}`),
    ["alpha:timestamps"],
  );
});

test("a note that is only the annotation is not a description", () => {
  const t = cleanTable("t1", "users");
  t.note = "lint-ignore: timestamps";
  assert.deepEqual(rulesOf(project([t])), ["table-description"]);
});

test("custom lists: forbidden types and required columns", () => {
  const t = cleanTable("t1", "users", [field("f1", "payload", "JSON"), field("f2", "tags", "text[]")]);
  const custom = settings({ forbiddenTypes: ["json", "Text"], requiredColumns: ["tenant_id", "ID"] });
  const findings = lintProject(project([t]), custom);
  assert.deepEqual(
    findings.map((f) => [f.ruleId, f.severity, f.fieldName ?? f.params.columns]),
    [
      ["forbidden-type", "error", "payload"],
      ["forbidden-type", "error", "tags"],
      ["required-column", "warning", "tenant_id"],
    ],
  );
});

test("undescribed columns are one finding per table, and obvious columns are not asked for one", () => {
  const t = cleanTable("t1", "users", [
    field("f1", "email", "varchar(320)", { note: "Login address." }),
    field("f2", "nickname", "varchar(40)"),
    field("f3", "locale", "varchar(5)", { note: "[tags: i18n]" }),
  ]);
  const on = settings({ rules: { "column-description": "warning" } });
  const findings = lintProject(project([t]), on);
  // `id`, `created_at` and `updated_at` say what they are; an annotation alone is not a description.
  assert.deepEqual(
    findings.map((f) => [f.ruleId, f.params.columns, f.params.count]),
    [["column-description", "nickname, locale", "2"]],
  );
  assert.deepEqual(rulesOf(project([t])), []);
});

test("personal data must sit in a table that says so", () => {
  const leaking = cleanTable("t1", "orders", [
    field("f1", "phone", "varchar(20)", { note: "Delivery contact. [class: personal]" }),
    field("f2", "status", "varchar(20)", { note: "[class: internal]" }),
  ]);
  const declared = cleanTable("t2", "customers", [field("f3", "iban", "varchar(34)", { note: "[class: sensitive]" })]);
  declared.note = "The customers. [class: personal]";
  const findings = lintProject(project([leaking, declared]));
  assert.deepEqual(
    findings.map((f) => [f.ruleId, f.severity, f.tableName, f.fieldName, f.params.classification]),
    [["personal-data-class", "warning", "orders", "phone", "personal"]],
  );
  assert.deepEqual(rulesOf(project([leaking, declared]), settings({ profile: "relaxed" })), []);
});

test("a foreign key that does not say what a delete does", () => {
  const users = cleanTable("t1", "users");
  const posts = cleanTable("t2", "posts", [field("a", "user_id"), field("b", "editor_id")]);
  posts.indexes = [
    { id: "i1", fieldIds: ["a"] },
    { id: "i2", fieldIds: ["b"] },
  ];
  const refs = [
    fk("r1", ["t2", "a"], ["t1", "t1-id"]),
    { ...fk("r2", ["t2", "b"], ["t1", "t1-id"]), onDelete: "set null" as const },
  ];
  const on = settings({ rules: { "fk-on-delete": "warning" } });
  // The finding is on the table that carries the key, not on the one it points at.
  assert.deepEqual(
    lintProject(project([users, posts], refs), on).map((f) => [f.ruleId, f.tableName, f.fieldName, f.fixable]),
    [["fk-on-delete", "posts", "user_id", false]],
  );
  assert.deepEqual(rulesOf(project([users, posts], refs)), []);
});

test("the fixes add an id key and an index, and nothing else", () => {
  const users = cleanTable("t1", "users");
  const posts = table("t2", "posts", [field("f1", "user_id")], { note: "Posts." });
  const p = project([users, posts], [fk("r1", ["t2", "f1"], ["t1", "t1-id"])]);
  const findings = lintProject(p, settings({ rules: { timestamps: "off" } }));
  assert.deepEqual(
    findings.map((f) => [f.ruleId, f.fixable]),
    [
      ["pk-required", true],
      ["fk-indexed", true],
    ],
  );

  let fixed = applyLintFix(p, findings[0], newId)!;
  assert.deepEqual(
    fixed.tables[1].fields.map((f) => [f.name, f.pk ?? false]),
    [
      ["id", true],
      ["user_id", false],
    ],
  );
  fixed = applyLintFix(fixed, findings[1], newId)!;
  assert.deepEqual(
    fixed.tables[1].indexes.map((idx) => idx.fieldIds),
    [["f1"]],
  );
  assert.deepEqual(lintProject(fixed, settings({ rules: { timestamps: "off" } })), []);
  // The input is left as it was, and a fix that no longer applies is refused.
  assert.equal(p.tables[1].fields.length, 1);
  assert.equal(applyLintFix(fixed, findings[0], newId), null);
  assert.equal(applyLintFix(fixed, findings[1], newId), null);
});

test("a keyless table that already has an id column is not fixed blindly", () => {
  const t = table("t1", "things", [field("f1", "id", "varchar(36)")], { note: "Things." });
  const [finding] = lintProject(project([t]), settings({ profile: "relaxed" }));
  assert.equal(finding.ruleId, "pk-required");
  assert.equal(finding.fixable, false);
  assert.equal(applyLintFix(project([t]), finding, newId), null);
});

test("settings from outside are checked", () => {
  assert.equal(parseLintSettings(null), null);
  assert.equal(parseLintSettings({ profile: "severe" }), null);
  assert.equal(parseLintSettings({ profile: "strict", rules: { "no-such-rule": "error" } }), null);
  assert.equal(parseLintSettings({ profile: "strict", rules: { timestamps: "fatal" } }), null);
  assert.equal(parseLintSettings({ profile: "strict", ignores: [{ ruleId: "timestamps" }] }), null);
  assert.equal(parseLintSettings({ profile: "strict", forbiddenTypes: [""] }), null);
  assert.equal(parseLintSettings({ profile: "strict", blockDeployment: "yes" }), null);

  assert.deepEqual(
    parseLintSettings({
      profile: "custom",
      rules: { timestamps: "off" },
      ignores: [
        { ruleId: "pk-required", tableId: "t1", tableName: "a" },
        { ruleId: "pk-required", tableId: "t1", tableName: "a" },
      ],
      forbiddenTypes: [" json ", "json"],
      blockDeployment: true,
      unknown: 1,
    }),
    {
      profile: "custom",
      rules: { timestamps: "off" },
      ignores: [{ ruleId: "pk-required", tableId: "t1", tableName: "a" }],
      forbiddenTypes: ["json"],
      requiredColumns: [],
      blockDeployment: true,
      customRules: [],
    },
  );
});

const customSettings = (customRules: NonNullable<LintSettings["customRules"]>): LintSettings => ({
  ...DEFAULT_LINT_SETTINGS,
  customRules,
});

test("a custom rule flags a table name that does not match its pattern", () => {
  const findings = lintProject(
    project([cleanTable("t1", "app_users"), cleanTable("t2", "orders")]),
    customSettings([
      {
        id: "app-prefix",
        label: "Tables start with app_",
        target: "table",
        must: "match",
        pattern: "^app_",
        level: "warning",
      },
    ]),
  ).filter((f) => f.ruleId === "custom:app-prefix");
  assert.deepEqual(
    findings.map((f) => [f.tableName, f.severity, f.message, f.fixable]),
    [["orders", "warning", "Tables start with app_", false]],
  );
});

test("a custom column rule can forbid a name, scoped to some tables, with a message template", () => {
  const users = cleanTable("t1", "users", [field("t1-p", "password")]);
  const logs = cleanTable("t2", "logs", [field("t2-p", "password")]);
  const findings = lintProject(
    project([users, logs]),
    customSettings([
      {
        id: "no-password",
        label: "No password column",
        target: "column",
        appliesTo: "^users$",
        must: "not-match",
        pattern: "^password$",
        level: "error",
        message: "{table}.{column} must not store a password",
      },
    ]),
  ).filter((f) => f.ruleId === "custom:no-password");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tableName, "users");
  assert.equal(findings[0].fieldName, "password");
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].message, "users.password must not store a password");
});

test("a custom rule is silenced by a setting exception, by the table's note, and by level off", () => {
  const rule = {
    id: "app-prefix",
    label: "Prefix",
    target: "table" as const,
    must: "match" as const,
    pattern: "^app_",
    level: "warning" as const,
  };
  const orders = cleanTable("t2", "orders");
  const run = (settings: LintSettings, tables = [orders]) =>
    lintProject(project(tables), settings).filter((f) => f.ruleId === "custom:app-prefix").length;

  assert.equal(run(customSettings([rule])), 1);
  assert.equal(run(customSettings([{ ...rule, level: "off" }])), 0);
  assert.equal(
    run({ ...customSettings([rule]), ignores: [{ ruleId: "custom:app-prefix", tableId: "t2", tableName: "orders" }] }),
    0,
  );
  assert.equal(run(customSettings([rule]), [{ ...orders, note: "The orders. lint-ignore: custom:app-prefix" }]), 0);
});

test("custom rules are validated: pattern, duplicate id, limit, level, and settings stored before they existed", () => {
  const base = { profile: "standard" };
  const rule = { id: "r1", label: "R", target: "table", must: "match", pattern: "^a", level: "info" };
  assert.deepEqual(parseLintSettings(base)?.customRules, [], "an older stored row has none");
  assert.equal(parseLintSettings({ ...base, customRules: [rule] })?.customRules.length, 1);
  assert.equal(
    parseLintSettings({ ...base, customRules: [{ ...rule, pattern: "(" }] }),
    null,
    "invalid regular expression",
  );
  assert.equal(parseLintSettings({ ...base, customRules: [{ ...rule, pattern: "a".repeat(201) }] }), null, "too long");
  assert.equal(parseLintSettings({ ...base, customRules: [{ ...rule, appliesTo: "[" }] }), null, "invalid scope");
  assert.equal(parseLintSettings({ ...base, customRules: [rule, rule] }), null, "duplicate id");
  assert.equal(parseLintSettings({ ...base, customRules: [{ ...rule, id: "Not A Slug" }] }), null, "bad id");
  assert.equal(parseLintSettings({ ...base, customRules: [{ ...rule, level: "fatal" }] }), null, "bad level");
  assert.equal(parseLintSettings({ ...base, customRules: [{ ...rule, target: "index" }] }), null, "bad target");
  const many = Array.from({ length: 21 }, (_, i) => ({ ...rule, id: `r${i}` }));
  assert.equal(parseLintSettings({ ...base, customRules: many }), null, "more than 20");
  assert.equal(
    parseLintSettings({ ...base, ignores: [{ ruleId: "custom:r1", tableId: "t1", tableName: "a" }] })?.ignores.length,
    1,
    "an exception can name a custom rule",
  );
  assert.equal(parseLintSettings({ ...base, ignores: [{ ruleId: "nope", tableId: "t1", tableName: "a" }] }), null);
});
