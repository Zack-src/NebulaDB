import test from "node:test";
import assert from "node:assert/strict";
import { migrateBrandStorage } from "./brandMigration";

test("preferences, viewports and plugin source survive an idempotent migration", () => {
  const values: Record<string, string> = {
    "athanordb.theme": "light",
    "nebuladb.theme": "obsidian",
    "athanordb.viewport.project.user": '{"x":12,"y":34}',
    athanordb_plugins: '[{"code":"athanor.plugin({id: \'custom\'})"}]',
    "athanor:perf": "1",
    "other.preference": "unchanged",
  };
  const storage = Object.assign(values, {});
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        values[key] = value;
      },
    },
  });
  migrateBrandStorage(storage as unknown as Storage);
  assert.equal(values["nebuladb.theme"], "obsidian");
  assert.equal(values["nebuladb.viewport.project.user"], values["athanordb.viewport.project.user"]);
  assert.equal(values.nebuladb_plugins, values.athanordb_plugins);
  assert.equal(values["nebula:perf"], "1");
  const snapshot = { ...values };
  migrateBrandStorage(storage as unknown as Storage);
  assert.deepEqual(values, snapshot);
});
