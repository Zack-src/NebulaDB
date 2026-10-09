import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "./testDatabase.js";

await useTestDatabase("db");

const { db, isUniqueViolation, numberPlaceholders } = await import("./db.js");

await db.exec("CREATE TABLE scratch (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)");

const count = async () => ((await db.prepare("SELECT COUNT(*) AS n FROM scratch").get()) as { n: number }).n;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("placeholders are numbered in order, and a `?` inside a literal, an identifier or a comment is left alone", () => {
  assert.equal(numberPlaceholders("SELECT 1"), "SELECT 1");
  assert.equal(numberPlaceholders("a = ? AND b IN (?, ?)"), "a = $1 AND b IN ($2, $3)");
  assert.equal(numberPlaceholders("a = '?' AND b = ?"), "a = '?' AND b = $1");
  assert.equal(numberPlaceholders("a = 'it''s ?' AND b = ?"), "a = 'it''s ?' AND b = $1");
  assert.equal(numberPlaceholders('"why?" = ?'), '"why?" = $1');
  assert.equal(numberPlaceholders("a = ? -- really?\nAND b = ?"), "a = $1 -- really?\nAND b = $2");
  assert.equal(numberPlaceholders("a = ? /* or ? */ AND b = ?"), "a = $1 /* or ? */ AND b = $2");
});

test("get returns the first row or undefined, all every row, run how many rows it changed", async () => {
  assert.equal(await db.prepare("SELECT id FROM scratch WHERE id = ?").get("nobody"), undefined);
  assert.deepEqual(await db.prepare("INSERT INTO scratch (id) VALUES (?), (?)").run("a", "b"), { changes: 2 });
  assert.deepEqual(await db.prepare("SELECT id FROM scratch WHERE id IN (?, ?) ORDER BY id").all("a", "b"), [
    { id: "a" },
    { id: "b" },
  ]);
  assert.deepEqual(await db.prepare("SELECT id FROM scratch ORDER BY id").get(), { id: "a" });
  assert.deepEqual(await db.prepare("DELETE FROM scratch WHERE id = ?").run("nobody"), { changes: 0 });
  await db.exec("DELETE FROM scratch");
});

test("counts and sums come back as numbers", async () => {
  await db.prepare("INSERT INTO scratch (id, n) VALUES ('x', 2), ('y', 3)").run();
  const row = (await db.prepare("SELECT COUNT(*) AS rows, SUM(n) AS total, AVG(n) AS mean FROM scratch").get()) as {
    rows: unknown;
    total: unknown;
    mean: unknown;
  };
  assert.deepEqual(row, { rows: 2, total: 5, mean: 2.5 });
  await db.exec("DELETE FROM scratch");
});

test("a transaction commits everything it did, wherever in the call tree it was done", async () => {
  // No handle is passed down: the helper below finds the transaction by itself.
  const insertElsewhere = async (id: string) => {
    await pause(1);
    await db.prepare("INSERT INTO scratch (id) VALUES (?)").run(id);
  };
  const result = await db.transaction(async () => {
    await insertElsewhere("t1");
    await insertElsewhere("t2");
    // Not committed yet: only this transaction sees its own rows.
    assert.equal(await count(), 2);
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(await count(), 2);
  await db.exec("DELETE FROM scratch");
});

test("a transaction that throws leaves nothing behind, and the error reaches the caller", async () => {
  await assert.rejects(
    db.transaction(async () => {
      await db.prepare("INSERT INTO scratch (id) VALUES ('doomed')").run();
      throw new Error("changed my mind");
    }),
    /changed my mind/,
  );
  assert.equal(await count(), 0);
});

test("what runs outside a transaction does not see it, nor wait for it", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const open = db.transaction(async () => {
    await db.prepare("INSERT INTO scratch (id) VALUES ('private')").run();
    await held;
  });
  await pause(20);
  // A statement issued from outside goes to another connection.
  assert.equal(await count(), 0);
  release();
  await open;
  assert.equal(await count(), 1);
  await db.exec("DELETE FROM scratch");
});

test("statements started together inside a transaction all run in it", async () => {
  await db
    .transaction(async () => {
      await Promise.all(
        ["p1", "p2", "p3", "p4"].map((id) => db.prepare("INSERT INTO scratch (id) VALUES (?)").run(id)),
      );
      throw new Error("undo");
    })
    .catch(() => {});
  assert.equal(await count(), 0);
});

test("a nested transaction is a savepoint: its failure, once caught, undoes only its own part", async () => {
  await db.transaction(async () => {
    await db.prepare("INSERT INTO scratch (id) VALUES ('outer')").run();
    await assert.rejects(
      db.transaction(async () => {
        await db.prepare("INSERT INTO scratch (id) VALUES ('inner')").run();
        // A duplicate key: in PostgreSQL this poisons a plain transaction for good.
        await db.prepare("INSERT INTO scratch (id) VALUES ('outer')").run();
      }),
      (err: unknown) => isUniqueViolation(err),
    );
    await db.prepare("INSERT INTO scratch (id) VALUES ('after')").run();
  });
  const ids = ((await db.prepare("SELECT id FROM scratch ORDER BY id").all()) as { id: string }[]).map((r) => r.id);
  assert.deepEqual(ids, ["after", "outer"]);
  await db.exec("DELETE FROM scratch");
});

test("work a transaction started and did not wait for goes to the pool once the transaction is over", async () => {
  let late!: Promise<unknown>;
  await db.transaction(async () => {
    late = pause(30).then(() => db.prepare("INSERT INTO scratch (id) VALUES ('late')").run());
  });
  // The transaction's connection is back in the pool; the insert must not be run on it as if still inside.
  await late;
  assert.equal(await count(), 1);
  await db.exec("DELETE FROM scratch");
});

test("concurrent transactions do not share a connection", async () => {
  await db.prepare("INSERT INTO scratch (id, n) VALUES ('counter', 0)").run();
  const bump = () =>
    db.transaction(async () => {
      const row = (await db.prepare("SELECT n FROM scratch WHERE id = 'counter' FOR UPDATE").get()) as { n: number };
      await pause(5);
      await db.prepare("UPDATE scratch SET n = ? WHERE id = 'counter'").run(row.n + 1);
    });
  await Promise.all(Array.from({ length: 8 }, bump));
  const row = (await db.prepare("SELECT n FROM scratch WHERE id = 'counter'").get()) as { n: number };
  assert.equal(row.n, 8, "each transaction read the value the one before it committed");
  await db.exec("DELETE FROM scratch");
});

test("isUniqueViolation tells a duplicate from any other failure, and one index from another", async () => {
  await db.prepare("INSERT INTO scratch (id) VALUES ('dup')").run();
  const duplicate = await db
    .prepare("INSERT INTO scratch (id) VALUES ('dup')")
    .run()
    .catch((err: unknown) => err);
  assert.ok(isUniqueViolation(duplicate));
  assert.ok(isUniqueViolation(duplicate, "scratch_pkey"));
  assert.ok(!isUniqueViolation(duplicate, "some_other_index"));
  const other = await db
    .prepare("INSERT INTO scratch (id, n) VALUES ('nul', NULL)")
    .run()
    .catch((err: unknown) => err);
  assert.ok(!isUniqueViolation(other));
  assert.ok(!isUniqueViolation(new Error("nothing to do with the database")));
  await db.exec("DELETE FROM scratch");
});
