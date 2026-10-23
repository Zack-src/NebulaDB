import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPALIVE_MAX_BYTES, toRequestInit } from "./httpClient";

test("keepalive is kept for a small body and dropped past what fetch accepts", () => {
  assert.equal(toRequestInit({ method: "POST", body: { source: "a" }, keepalive: true }).keepalive, true);
  const big = { source: "x".repeat(KEEPALIVE_MAX_BYTES) };
  assert.equal(toRequestInit({ method: "POST", body: big, keepalive: true }).keepalive, undefined);
  assert.equal(toRequestInit({ method: "POST", body: { source: "a" } }).keepalive, undefined);
});
