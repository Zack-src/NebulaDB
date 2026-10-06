import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.NEBULADB_DB_PATH ??= join(tmpdir(), `nebuladb-test-grants-${randomUUID()}.sqlite`);

const { parseGrantLine } = await import("./mysql.js");

test("parseGrantLine reads server, database and table grants", () => {
  assert.deepEqual(parseGrantLine("GRANT SELECT, INSERT ON *.* TO `app`@`%` WITH GRANT OPTION").grant, {
    scope: "server",
    privileges: ["SELECT", "INSERT"],
    grantable: true,
  });
  assert.deepEqual(parseGrantLine("GRANT ALL PRIVILEGES ON `shop`.* TO `app`@`%`").grant, {
    scope: "database",
    database: "shop",
    privileges: ["ALL PRIVILEGES"],
    grantable: false,
  });
  assert.deepEqual(parseGrantLine("GRANT SELECT (`id`, `name`), UPDATE ON `shop`.`users` TO 'app'@'localhost'").grant, {
    scope: "table",
    database: "shop",
    table: "users",
    privileges: ["SELECT (`ID`, `NAME`)", "UPDATE"],
    grantable: false,
  });
});

test("parseGrantLine reads role memberships on MySQL 8 and MariaDB", () => {
  assert.equal(parseGrantLine("GRANT `reader`@`%`,`writer`@`%` TO `app`@`%`").role, "reader, writer");
  assert.equal(parseGrantLine("GRANT reader TO `app`@`%`").role, "reader");
  assert.deepEqual(parseGrantLine("SET DEFAULT ROLE reader FOR app"), {});
});
