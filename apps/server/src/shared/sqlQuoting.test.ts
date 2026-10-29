import assert from "node:assert/strict";
import test from "node:test";
import { q, type MigrationDialect } from "@nebuladb/dbml-engine";
import {
  CONNECT_TIMEOUT_MS,
  quoteBacktick,
  quoteBracket,
  quoteDouble,
  quoteIdentifier,
  quotingStyleFor,
  sqlLiteral,
} from "./sqlQuoting.js";

test("quoteDouble/Backtick/Bracket double their own closing character", () => {
  assert.equal(quoteDouble('a"b'), '"a""b"');
  assert.equal(quoteBacktick("a`b"), "`a``b`");
  assert.equal(quoteBracket("a]b"), "[a]]b]");
  assert.equal(quoteDouble("plain"), '"plain"');
  assert.equal(quoteBracket("[open"), "[[open]");
});

test("quotingStyleFor maps engines to a style", () => {
  assert.equal(quotingStyleFor("mysql"), "backtick");
  assert.equal(quotingStyleFor("bigquery"), "backtick");
  assert.equal(quotingStyleFor("mssql"), "bracket");
  for (const engine of ["postgres", "oracle", "sqlite"]) assert.equal(quotingStyleFor(engine), "double");
});

test("quoteIdentifier agrees with dbml-engine q() for every dialect", () => {
  const dialects: MigrationDialect[] = ["postgres", "mysql", "mssql", "oracle", "sqlite", "bigquery"];
  for (const dialect of dialects) {
    for (const ident of ["users", 'we"ird', "back`tick", "br]acket", "", "a b"]) {
      assert.equal(quoteIdentifier(ident, dialect), q(ident, dialect), `${dialect}: ${ident}`);
    }
  }
});

test("sqlLiteral doubles single quotes and nothing else", () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral("a\\b"), "'a\\b'");
  assert.equal(sqlLiteral(""), "''");
});

test("connect timeout default stays 5 seconds", () => {
  assert.equal(CONNECT_TIMEOUT_MS, 5000);
});
