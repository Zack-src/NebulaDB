import { test } from "node:test";
import assert from "node:assert/strict";
import { dbAccessPresets, dbRoleInfo, dbRoleNames, type DatabaseEngine } from "@nebuladb/shared";
import en from "../../../locales/en.json" with { type: "json" };
import fr from "../../../locales/fr.json" with { type: "json" };

const ENGINES: DatabaseEngine[] = ["mssql", "postgres", "oracle", "mysql"];

test("every catalogued role has its explanation in both languages", () => {
  for (const engine of ENGINES) {
    for (const role of dbRoleNames(engine)) {
      const key = dbRoleInfo(engine, role)?.descriptionKey ?? "";
      assert.ok(key, `${engine}/${role}: no catalogue entry`);
      for (const [name, dictionary] of [["fr", fr], ["en", en]] as const) {
        assert.ok((dictionary as Record<string, string>)[key], `${name}: missing ${key}`);
      }
    }
  }
});

test("lookup ignores case, and an unknown role has no entry", () => {
  assert.equal(dbRoleInfo("mssql", "DBCreator")?.risk, "medium");
  assert.equal(dbRoleInfo("oracle", "DBA")?.risk, "high");
  assert.equal(dbRoleInfo("mssql", "my_custom_role"), undefined);
});

test("access presets only exist where the engine ships matching roles", () => {
  assert.equal(dbAccessPresets("mssql", false), null);
  assert.deepEqual(dbAccessPresets("mssql", true)?.admin, ["db_owner"]);
  assert.deepEqual(dbAccessPresets("postgres", false)?.read, ["pg_read_all_data"]);
  assert.equal(dbAccessPresets("mysql", false), null);
});

test("every preset role is one the catalogue explains", () => {
  const presets = [dbAccessPresets("mssql", true), dbAccessPresets("postgres", false)];
  const engines: DatabaseEngine[] = ["mssql", "postgres"];
  presets.forEach((preset, i) => {
    for (const role of Object.values(preset ?? {}).flat()) {
      assert.ok(dbRoleInfo(engines[i], role), `${engines[i]}/${role} not catalogued`);
    }
  });
});
