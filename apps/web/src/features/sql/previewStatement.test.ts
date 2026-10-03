import { test } from "node:test";
import assert from "node:assert/strict";
import { previewRowsStatement, quoteIdentifier } from "./previewStatement";

test("plain lower-case names are left as typed; anything else is quoted the engine's way", () => {
  assert.equal(quoteIdentifier("users", "postgres"), "users");
  assert.equal(quoteIdentifier("order_items2", "mysql"), "order_items2");
  assert.equal(quoteIdentifier("Order Items", "postgres"), '"Order Items"');
  assert.equal(quoteIdentifier("Users", "oracle"), '"Users"');
  assert.equal(quoteIdentifier("Order Items", "mysql"), "`Order Items`");
  assert.equal(quoteIdentifier("Order Items", "mssql"), "[Order Items]");
  // `user` and `order` are tables in half the schemas ever written, and keywords everywhere.
  assert.equal(quoteIdentifier("user", "postgres"), '"user"');
  assert.equal(quoteIdentifier("order", "mysql"), "`order`");
  assert.equal(quoteIdentifier("orders", "mysql"), "orders");
  // The quote character itself is doubled, so a name cannot close its own quotes.
  assert.equal(quoteIdentifier('we"ird', "postgres"), '"we""ird"');
  assert.equal(quoteIdentifier("we`ird", "mysql"), "`we``ird`");
  assert.equal(quoteIdentifier("we]ird", "mssql"), "[we]]ird]");
});

test("the preview statement speaks each engine's dialect", () => {
  assert.equal(previewRowsStatement("postgres", { name: "users" }), "SELECT * FROM users LIMIT 100");
  assert.equal(previewRowsStatement("sqlite", { name: "users" }, 10), "SELECT * FROM users LIMIT 10");
  assert.equal(previewRowsStatement("mysql", { name: "Order Items" }), "SELECT * FROM `Order Items` LIMIT 100");
  assert.equal(previewRowsStatement("mssql", { name: "users", schemaName: "dbo" }), "SELECT TOP 100 * FROM dbo.users");
  assert.equal(
    previewRowsStatement("oracle", { name: "USERS", schemaName: "SHOP" }),
    'SELECT * FROM "SHOP"."USERS" FETCH FIRST 100 ROWS ONLY',
  );
});
