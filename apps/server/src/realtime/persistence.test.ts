import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-persistence-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { appendRevision, listRevisions, listMeaningfulRevisions, setRevisionLabel } = await import("./persistence.js");
const { writeProjectToDoc } = await import("@athanordb/shared");
const { db } = await import("../infrastructure/db.js");
type Project = import("@athanordb/shared").Project;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Test project",
    tables: [],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
    ...overrides,
  };
}

/** Writes `project` into a scratch doc seeded with every update applied so far, and appends the resulting delta as a revision — mirrors what `Room.handleDocUpdate` does for a real collaborative edit, without the WebSocket/room machinery. */
function commit(doc: Y.Doc, projectId: string, author: string, project: Project): string {
  let update: Uint8Array | null = null;
  const capture = (u: Uint8Array) => {
    update = u;
  };
  doc.on("update", capture);
  writeProjectToDoc(doc, project);
  doc.off("update", capture);
  if (!update) throw new Error("write produced no update — project must differ from the doc's current content");
  appendRevision(projectId, author, update);
  const rows = db
    .prepare(`SELECT id FROM revisions WHERE project_id = ? ORDER BY rowid DESC LIMIT 1`)
    .get(projectId) as { id: string };
  return rows.id;
}

test("listMeaningfulRevisions drops a revision that only moved a table (no schema change), keeps ones that changed the schema", async () => {
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(projectId, "Test project");
  const doc = new Y.Doc();

  const table = {
    id: "t1",
    name: "users",
    fields: [{ id: "f1", name: "id", type: "int", pk: true }],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard" as const,
  };

  commit(doc, projectId, "alice", makeProject({ tables: [table] }));
  commit(doc, projectId, "alice", makeProject({ tables: [{ ...table, position: { x: 400, y: 250 } }] }));
  commit(
    doc,
    projectId,
    "alice",
    makeProject({
      tables: [
        { ...table, position: { x: 400, y: 250 } },
        {
          id: "t2",
          name: "orders",
          fields: [{ id: "f2", name: "id", type: "int", pk: true }],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard" as const,
        },
      ],
    }),
  );

  const all = listRevisions(projectId);
  assert.equal(all.length, 3, "every doc update still gets its own row in the raw log");

  const meaningful = listMeaningfulRevisions(projectId);
  assert.equal(meaningful.length, 2, "the position-only revision is dropped");
  assert.deepEqual(
    meaningful.map((r) => r.id),
    [all[0].id, all[2].id],
  );
});

test("listMeaningfulRevisions keeps a labeled revision even when it changed nothing", async () => {
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(projectId, "Test project");
  const doc = new Y.Doc();

  const table = {
    id: "t1",
    name: "users",
    fields: [{ id: "f1", name: "id", type: "int", pk: true }],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard" as const,
  };

  commit(doc, projectId, "alice", makeProject({ tables: [table] }));
  const noOpId = commit(doc, projectId, "alice", makeProject({ tables: [{ ...table, position: { x: 10, y: 10 } }] }));
  assert.ok(setRevisionLabel(projectId, noOpId, "checkpoint"));

  const meaningful = listMeaningfulRevisions(projectId);
  assert.equal(meaningful.length, 2);
  assert.equal(meaningful[1].id, noOpId);
  assert.equal(meaningful[1].label, "checkpoint");
});
