import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@nebuladb/shared";
import { parseDbml, toProject } from "./dbml.js";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateMigrationSql } from "./migrationGenerator.js";

const SOURCE = `Table user {
  id integer [pk]
  email varchar(255)
  Indexes {
    email [unique]
  }
}

Table link {
  user_id integer
  group_id integer
  Indexes {
    (user_id, group_id) [pk]
    group_id
  }
}
`;

test("a table created by a migration gets its indexes, not the primary key's", () => {
  const project = toProject(parseDbml(SOURCE), "p", SOURCE);
  const empty: Project = { ...project, tables: [], refs: [] };
  const sql = generateMigrationSql(diffTargetAgainstLive(empty, project), "mssql");
  assert.match(sql, /CREATE UNIQUE INDEX \[idx_user_email\] ON \[user\] \(\[email\]\);/);
  assert.match(sql, /CREATE INDEX \[idx_link_group_id\] ON \[link\] \(\[group_id\]\);/);
  assert.equal((sql.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length, 2);
});
