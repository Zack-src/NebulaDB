import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import type { Project } from "@nebuladb/shared";
import {
  mergeProjectIntoExisting,
  parseDbml,
  preserveConcurrentAdditions,
  projectToDbml,
  toProject,
} from "@nebuladb/dbml-engine";
import { ECHO_GRACE_MS, TYPING_QUIET_MS, createBufferSync, minimalChange } from "@/features/editor/dbml/bufferSync";
import { dbmlSignature } from "@/features/editor/dbml/symbols";

/**
 * Regression coverage for the "my edit gets rolled back while I type" report
 * (docs/todo.md, Phase 29). The server below is the real import pipeline —
 * parse, merge by name, three-way merge against the baseline — minus HTTP, so
 * these tests fail for the reason the bug happened, not for a mocked one.
 */

const TABLES = `Table users {
  id int [pk]
}

Table customers {
  id int [pk]
}

Table orders {
  id int [pk]
  user_id int
}
`;
const BEFORE = `${TABLES}\nRef: orders.user_id > users.id\n`;

const EMPTY: Project = {
  id: "",
  name: "p",
  tables: [],
  refs: [],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
};
const parse = (source: string) => toProject(parseDbml(source), "p", source);

function fakeServer(initial: string) {
  let doc = parse(initial);
  const held: Array<() => void> = [];
  let hold = false;
  return {
    get dbml() {
      return projectToDbml(doc);
    },
    refs: () =>
      projectToDbml(doc)
        .split("\n")
        .filter((line) => line.startsWith("Ref")),
    /** Answers stay pending until `release()`. */
    holdAnswers: () => (hold = true),
    release() {
      held.splice(0).forEach((resolve) => resolve());
    },
    async import(source: string, baseline: string | undefined) {
      const parsed = parse(source); // throws on invalid DBML, like the route
      const merged = mergeProjectIntoExisting(doc, parsed);
      let baselineProject = EMPTY;
      try {
        if (baseline) baselineProject = parse(baseline);
      } catch {
        // same fallback as `parseBaselineProject`
      }
      doc = baseline ? preserveConcurrentAdditions(doc, merged, baselineProject) : merged;
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
    },
  };
}

function client(server: ReturnType<typeof fakeServer>) {
  const clock = { now: 0 };
  const errors: unknown[] = [];
  const sync = createBufferSync({
    initialText: server.dbml,
    signatureOf: dbmlSignature,
    send: (source, baseline) => server.import(source, baseline),
    onSettled: (error) => errors.push(error),
    now: () => clock.now,
  });
  return { sync, clock, errors };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("retargeting a Ref through a half-typed table name does not bring the old Ref back", async () => {
  const server = fakeServer(BEFORE);
  const { sync, clock, errors } = client(server);

  // The user pauses on `cust` long enough for the debounce to fire…
  sync.edit(BEFORE.replace("> users.id", "> cust.id"));
  sync.flush();
  await settle();
  assert.equal(errors.length, 1, "the half-typed buffer is rejected");
  assert.ok(errors[0]);
  assert.equal(sync.status, "error");

  // …then finishes the name.
  const typed = BEFORE.replace("> users.id", "> customers.id");
  sync.edit(typed);
  sync.flush();
  await settle();

  assert.deepEqual(server.refs(), ["Ref: orders.user_id > customers.id"]);
  clock.now += TYPING_QUIET_MS;
  assert.deepEqual(sync.offerDocument(server.dbml), {}, "the buffer already says what the document says");
  assert.equal(sync.text, typed);
  assert.equal(sync.status, "synced");
});

test("an import answering for an older revision does not let the document replace newer typing", async () => {
  const server = fakeServer(BEFORE);
  const { sync, clock } = client(server);
  const documentBefore = server.dbml;

  server.holdAnswers();
  sync.edit(BEFORE.replace("user_id int", "user_id int [not null]"));
  sync.flush();
  // typed while that import is in flight, and the debounce fires again
  const newer = BEFORE.replace("user_id int", "user_id bigint [not null]");
  sync.edit(newer);
  sync.flush();
  server.release();
  await settle();

  clock.now += 10_000;
  assert.equal(sync.text, newer);
  assert.equal(sync.dirty, true, "the first answer was for an older revision");
  assert.deepEqual(sync.offerDocument(documentBefore), {});
  server.release();
  await settle();
  assert.equal(sync.dirty, false, "the queued import went out once the first was acknowledged");
  assert.match(server.dbml, /user_id bigint \[not null\]/);
});

test("the pre-import document is not mirrored back while the realtime update is still on its way", async () => {
  const server = fakeServer(BEFORE);
  const { sync, clock } = client(server);
  const stale = server.dbml;

  const typed = `// my notes\n${BEFORE.replace("> users.id", "> customers.id")}`;
  sync.edit(typed);
  sync.flush();
  await settle();
  clock.now += TYPING_QUIET_MS;

  // HTTP answered first: the panel still holds the old project.
  const offer = sync.offerDocument(stale);
  assert.equal(offer.adopt, undefined);
  assert.ok(offer.retryInMs && offer.retryInMs <= ECHO_GRACE_MS);
  // The update lands: same schema as the buffer, so the user's text stays.
  assert.deepEqual(sync.offerDocument(server.dbml), {});
  assert.equal(sync.text, typed);
});

test("an import the server turned into a no-op is reconciled once the grace period is over", async () => {
  const { sync, clock } = client(fakeServer(BEFORE));
  sync.edit(`${BEFORE}\nTable ghosts {\n  id int\n}\n`);
  sync.flush();
  await settle();
  clock.now += ECHO_GRACE_MS + 1;
  // the document never changed (as if the server had refused the table)
  assert.equal(sync.offerDocument(projectToDbml(parse(BEFORE))).adopt, projectToDbml(parse(BEFORE)));
});

test("two clients: neither deletes the other's addition, and an idle buffer picks it up", async () => {
  const server = fakeServer(BEFORE);
  const alice = client(server);
  const bob = client(server);

  bob.sync.edit(`${bob.sync.text}\nTable invoices {\n  id int [pk]\n}\n`);
  bob.sync.flush();
  await settle();

  // Alice has not seen `invoices` yet and retargets the relation.
  alice.sync.edit(alice.sync.text.replace("> users.id", "> customers.id"));
  alice.sync.flush();
  await settle();
  assert.match(server.dbml, /Table invoices/);
  assert.deepEqual(server.refs(), ["Ref: orders.user_id > customers.id"]);

  // Right after her keystroke nothing is pushed into her buffer…
  assert.ok(alice.sync.offerDocument(server.dbml).retryInMs);
  // …once she pauses, the collaborator's table arrives.
  alice.clock.now += TYPING_QUIET_MS;
  assert.equal(alice.sync.offerDocument(server.dbml).adopt, server.dbml);

  // and deleting it afterwards is a real deletion, not a "never saw it"
  alice.sync.edit(alice.sync.text.replace(/\nTable invoices \{[^}]*\}\n/, ""));
  alice.sync.flush();
  await settle();
  assert.doesNotMatch(server.dbml, /Table invoices/);
});

test("a document resync is one minimal change, and the cursor follows the text it was in", () => {
  const typed = BEFORE;
  const cursor = typed.indexOf("users.id") + 3;
  let state = EditorState.create({ doc: typed, selection: { anchor: cursor } });
  const next = typed.replace("id int [pk]\n}", "id int [pk]\n  email varchar\n}");

  const change = minimalChange(typed, next);
  assert.ok(change);
  assert.equal(change.insert.trim(), "email varchar");
  state = state.update({ changes: change }).state;
  assert.equal(state.doc.toString(), next);
  assert.equal(state.sliceDoc(state.selection.main.anchor - 3, state.selection.main.anchor + 5), "users.id");
  assert.equal(minimalChange(next, next), null);
});
