import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import type { Project } from "@athanordb/shared";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-backup-test-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";

const { db } = await import("./db.js");
const { runBackup, pruneOldBackups, backupTimestamp, sanitizeFilename } = await import("./backupRunner.js");
const { appendRevision } = await import("./yjs/persistence.js");
const { writeProjectToDoc, readProjectFromDoc } = await import("@athanordb/shared");
const { parseDbml, toProject, applyVisualMetadata } = await import("@athanordb/dbml-engine");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "athanordb-backup-"));
}

/** Creates a project whose revision log contains one table, the way a real edit would. */
function seedProject(name: string, tableName: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, name);

  const doc = new Y.Doc();
  const project: Project = {
    id,
    name,
    tables: [
      {
        id: randomUUID(),
        name: tableName,
        position: { x: 40, y: 80 },
        detailLevel: "standard",
        indexes: [],
        fields: [
          { id: randomUUID(), name: "id", type: "uuid", pk: true },
          { id: randomUUID(), name: "label", type: "varchar" },
        ],
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  doc.transact(() => writeProjectToDoc(doc, project));
  // The backup replays the revision log, not the snapshot — so the test has to
  // produce a revision, exactly as a live edit does.
  appendRevision(id, "tester", Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return id;
}

test("a backup writes one .dbml per project, named after it", () => {
  const dir = scratch();
  seedProject("Ventes Europe", "customers");
  const result = runBackup(dir);

  assert.equal(result.backedUp, 1);
  const files = readdirSync(dir);
  assert.deepEqual(files, ["Ventes_Europe.dbml"]);
  assert.match(readFileSync(join(dir, files[0]), "utf-8"), /Table customers/);
});

test("a project with no revisions is skipped, not written empty", () => {
  const dir = scratch();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(randomUUID(), "Never edited");
  const result = runBackup(dir);
  assert.ok(result.skipped >= 1);
  assert.equal(
    readdirSync(dir).includes("Never_edited.dbml"),
    false,
    "an empty file would look like a successful backup of nothing",
  );
});

test("two projects with the same name don't overwrite each other", () => {
  const dir = scratch();
  seedProject("Duplicate", "alpha");
  seedProject("Duplicate", "beta");
  runBackup(dir);
  const files = readdirSync(dir).filter((f) => f.startsWith("Duplicate")).sort();
  assert.deepEqual(files, ["Duplicate-1.dbml", "Duplicate.dbml"]);
});

test("backup → restore round-trips the schema", () => {
  // The point of the whole feature: a backup nobody has ever restored is not a
  // backup. This runs the real backup writer, then the same parse/convert path
  // `restore.ts` uses, and compares the result to what went in.
  const dir = scratch();
  const projectId = seedProject("Round Trip", "orders");
  runBackup(dir);

  const source = readFileSync(join(dir, "Round_Trip.dbml"), "utf-8");
  const restored = applyVisualMetadata(toProject(parseDbml(source), "Round Trip", source), source);

  assert.equal(restored.tables.length, 1);
  const table = restored.tables[0];
  assert.equal(table.name, "orders");
  assert.deepEqual(
    table.fields.map((f) => f.name),
    ["id", "label"],
  );
  assert.equal(table.fields[0].pk, true, "the primary key survives the round trip");
  // Visual metadata rides along in a comment — losing it means every restored
  // project comes back as an unreadable pile at the origin.
  assert.deepEqual(table.position, { x: 40, y: 80 });

  // And the restored doc is loadable, which is what `restore.ts` then persists.
  const doc = new Y.Doc();
  doc.transact(() => writeProjectToDoc(doc, { ...restored, id: projectId, name: "Round Trip" }));
  assert.equal(readProjectFromDoc(doc, projectId, "Round Trip").tables[0].name, "orders");
  doc.destroy();
});

test("pruneOldBackups keeps the newest N and deletes the rest", () => {
  const root = scratch();
  const stamps = [
    backupTimestamp(new Date("2026-01-01T00:00:00Z")),
    backupTimestamp(new Date("2026-02-01T00:00:00Z")),
    backupTimestamp(new Date("2026-03-01T00:00:00Z")),
    backupTimestamp(new Date("2026-04-01T00:00:00Z")),
  ];
  for (const s of stamps) {
    mkdirSync(join(root, s));
    writeFileSync(join(root, s, "x.dbml"), "Table x { }", "utf-8");
  }

  assert.equal(pruneOldBackups(root, 2), 2);
  assert.deepEqual(readdirSync(root).sort(), [stamps[2], stamps[3]].sort(), "the two newest survive");
});

test("pruneOldBackups leaves anything that isn't a timestamped backup alone", () => {
  const root = scratch();
  mkdirSync(join(root, backupTimestamp(new Date("2026-01-01T00:00:00Z"))));
  mkdirSync(join(root, "keep-me-manual-backup"));
  writeFileSync(join(root, "notes.txt"), "not a backup", "utf-8");

  pruneOldBackups(root, 0 + 1);
  const left = readdirSync(root);
  assert.ok(left.includes("keep-me-manual-backup"), "an operator's own folder is not ours to delete");
  assert.ok(left.includes("notes.txt"));
});

test("sanitizeFilename never produces an empty or path-escaping name", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "etc_passwd");
  assert.equal(sanitizeFilename("///"), "untitled");
  assert.equal(sanitizeFilename("Café Ventes"), "Caf_Ventes");
});
