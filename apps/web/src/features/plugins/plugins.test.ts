import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@athanordb/shared";
import {
  generateSqlite,
  generateTypeScript,
  generatePrisma,
  generateMermaid,
  generateJsonSchema,
  toSnakeCase,
  toCamelCase,
  toPascalCase,
  auditSchema,
  calculateSchemaStats,
} from "./generators";
import { importJsonSchemaToDbml, importSqliteToDbml } from "./importers";
import { BUILTIN_PLUGINS } from "./builtins";

const sampleProject: Project = {
  id: "proj-1",
  name: "Test E-Commerce",
  tables: [
    {
      id: "tbl-users",
      name: "users",
      detailLevel: "standard",
      position: { x: 100, y: 100 },
      fields: [
        { id: "f-id", name: "id", type: "uuid", pk: true },
        { id: "f-email", name: "email", type: "varchar", notNull: true, unique: true },
        { id: "f-name", name: "full_name", type: "varchar" },
      ],
      indexes: [],
    },
    {
      id: "tbl-orders",
      name: "orders",
      detailLevel: "standard",
      position: { x: 400, y: 100 },
      fields: [
        { id: "f-oid", name: "id", type: "int", pk: true, increment: true },
        { id: "f-uid", name: "user_id", type: "uuid", notNull: true },
        { id: "f-total", name: "total_amount", type: "decimal", default: "0" },
      ],
      indexes: [],
    },
  ],
  refs: [
    {
      id: "ref-1",
      name: "user_orders",
      from: { tableId: "tbl-orders", fieldId: "f-uid" },
      to: { tableId: "tbl-users", fieldId: "f-id" },
      cardinality: "one-to-many",
    },
  ],
  enums: [
    {
      id: "enum-status",
      name: "order_status",
      position: { x: 0, y: 0 },
      values: [
        { id: "val-pending", name: "PENDING" },
        { id: "val-completed", name: "COMPLETED" },
      ],
    },
  ],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
};

describe("Plugin Generators", () => {
  it("case conversions work accurately", () => {
    assert.equal(toSnakeCase("userProfileDetails"), "user_profile_details");
    assert.equal(toSnakeCase("User_Order"), "user_order");
    assert.equal(toCamelCase("user_profile_details"), "userProfileDetails");
    assert.equal(toPascalCase("user_profile_details"), "UserProfileDetails");
  });

  it("generateSqlite emits valid SQLite DDL with foreign keys and storage classes", () => {
    const ddl = generateSqlite(sampleProject, { foreignKeys: true, ifNotExists: true });
    assert.match(ddl, /PRAGMA foreign_keys = ON;/);
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS "users"/);
    assert.match(ddl, /"id" TEXT PRIMARY KEY/);
    assert.match(ddl, /"email" TEXT NOT NULL UNIQUE/);
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS "orders"/);
    assert.match(ddl, /FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/);
  });

  it("generateTypeScript emits typed interfaces and enums", () => {
    const ts = generateTypeScript(sampleProject, { exportType: "interface", camelCaseFields: true });
    assert.match(ts, /export type OrderStatus =/);
    assert.match(ts, /"PENDING"/);
    assert.match(ts, /export interface Users {/);
    assert.match(ts, /id: string;/);
    assert.match(ts, /email: string;/);
    assert.match(ts, /fullName\?: string;/);
    assert.match(ts, /export interface Orders {/);
    assert.match(ts, /totalAmount\?: number;/);
  });

  it("generatePrisma emits valid schema.prisma models with relations", () => {
    const prisma = generatePrisma(sampleProject, { datasourceProvider: "postgresql" });
    assert.match(prisma, /provider = "postgresql"/);
    assert.match(prisma, /model Users {/);
    assert.match(prisma, /id\s+String\s+@id/);
    assert.match(prisma, /email\s+String\s+@unique/);
    assert.match(prisma, /model Orders {/);
    assert.match(prisma, /id\s+Int\s+@id @default\(autoincrement\(\)\)/);
    assert.match(prisma, /users\s+Users\s+@relation/);
  });

  it("generateMermaid emits erDiagram syntax", () => {
    const mmd = generateMermaid(sampleProject);
    assert.match(mmd, /erDiagram/);
    assert.match(mmd, /orders \|\|--o{ users : "user_orders"/);
    assert.match(mmd, /users {/);
    assert.match(mmd, /varchar email UK/);
  });

  it("generateJsonSchema emits valid draft-07 JSON Schema", () => {
    const jsonStr = generateJsonSchema(sampleProject);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.$schema, "http://json-schema.org/draft-07/schema#");
    assert.ok(parsed.definitions.users);
    assert.ok(parsed.definitions.orders);
    assert.equal(parsed.definitions.users.properties.email.type, "string");
  });

  it("auditSchema and calculateSchemaStats inspect schema structure", () => {
    const audit = auditSchema(sampleProject);
    assert.equal(audit.errors.length, 0);

    const stats = calculateSchemaStats(sampleProject);
    assert.equal(stats.tableCount, 2);
    assert.equal(stats.fieldCount, 6);
    assert.equal(stats.refCount, 1);
    assert.equal(stats.enumCount, 1);
  });
});

describe("Plugin Importers", () => {
  it("importSqliteToDbml parses SQLite DDL into DBML", () => {
    const ddl = `
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL DEFAULT 0.0
      );
    `;
    const dbml = importSqliteToDbml(ddl);
    assert.match(dbml, /Table products {/);
    assert.match(dbml, /id integer \[pk, increment\]/);
    assert.match(dbml, /name text \[not null\]/);
  });

  it("importJsonSchemaToDbml parses JSON Schema object into DBML", () => {
    const schema = JSON.stringify({
      title: "Customer",
      type: "object",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name"],
    });
    const dbml = importJsonSchemaToDbml(schema);
    assert.match(dbml, /Table Customer {/);
    assert.match(dbml, /id int \[pk\]/);
    assert.match(dbml, /name varchar \[not null\]/);
  });
});

describe("Built-in Plugins", () => {
  it("all built-in native plugins are defined with valid manifests and contributions", () => {
    assert.equal(BUILTIN_PLUGINS.length, 4);
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    assert.ok(ids.includes("athanordb.core-export"));
    assert.ok(ids.includes("athanordb.core-import"));
    assert.ok(ids.includes("athanordb.core-canvas"));
    assert.ok(ids.includes("athanordb.core-editor"));
  });
});
