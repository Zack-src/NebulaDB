import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { KEEPALIVE_MAX_BYTES, request, requestBlob, requestText, toRequestInit } from "./httpClient";
import { ApiError, NetworkError } from "./ApiError";
import { jsonResponse, mockFetch } from "../test/fetchMock";

let mock: ReturnType<typeof mockFetch> | null = null;
afterEach(() => {
  mock?.restore();
  mock = null;
  delete (globalThis as { window?: unknown }).window;
});

test("keepalive is kept for a small body and dropped past what fetch accepts", () => {
  assert.equal(toRequestInit({ method: "POST", body: { source: "a" }, keepalive: true }).keepalive, true);
  const big = { source: "x".repeat(KEEPALIVE_MAX_BYTES) };
  assert.equal(toRequestInit({ method: "POST", body: big, keepalive: true }).keepalive, undefined);
  assert.equal(toRequestInit({ method: "POST", body: { source: "a" } }).keepalive, undefined);
});

describe("toRequestInit", () => {
  test("a bodiless request is a plain GET without headers", () => {
    const init = toRequestInit({});
    assert.equal(init.method, "GET");
    assert.equal("headers" in init, false);
    assert.equal("body" in init, false);
  });

  test("a body is serialised as JSON and announces itself", () => {
    const init = toRequestInit({ method: "PUT", body: { a: 1 } });
    assert.equal(init.body, '{"a":1}');
    assert.deepEqual(init.headers, { "Content-Type": "application/json" });
  });

  test("keepalive without a body is allowed", () => {
    assert.equal(toRequestInit({ keepalive: true }).keepalive, true);
  });

  test("no credentials or CSRF header is added: the same-origin session cookie does the work", () => {
    const init = toRequestInit({ method: "POST", body: {} });
    assert.equal("credentials" in init, false);
    assert.deepEqual(Object.keys(init.headers as object), ["Content-Type"]);
  });
});

describe("request", () => {
  test("parses a JSON answer", async () => {
    mock = mockFetch(jsonResponse({ ok: true, n: 2 }));
    assert.deepEqual(await request("/api/x"), { ok: true, n: 2 });
    assert.equal(mock.last().url, "/api/x");
    assert.equal(mock.last().init.method, "GET");
  });

  test("an empty body (204) resolves to undefined", async () => {
    mock = mockFetch(new Response(null, { status: 204 }));
    assert.equal(await request("/api/x", { method: "DELETE" }), undefined);
  });

  test("sends the body as JSON", async () => {
    mock = mockFetch(jsonResponse({}));
    await request("/api/x", { method: "POST", body: { name: "a b" } });
    assert.equal(mock.last().init.method, "POST");
    assert.deepEqual(mock.last().json, { name: "a b" });
  });

  test("query: skips undefined, stringifies numbers and booleans, encodes values", async () => {
    mock = mockFetch(jsonResponse({}));
    await request("/api/x", { query: { a: "x y&z", b: 3, c: false, d: undefined } });
    assert.equal(mock.last().url, "/api/x?a=x+y%26z&b=3&c=false");
  });

  test("query: an all-undefined query leaves the path alone", async () => {
    mock = mockFetch(jsonResponse({}));
    await request("/api/x", { query: { a: undefined } });
    assert.equal(mock.last().url, "/api/x");
  });

  test("query: an empty string is kept (only undefined is dropped)", async () => {
    mock = mockFetch(jsonResponse({}));
    await request("/api/x", { query: { q: "" } });
    assert.equal(mock.last().url, "/api/x?q=");
  });

  test("forwards the abort signal to fetch", async () => {
    mock = mockFetch(jsonResponse({}));
    const controller = new AbortController();
    await request("/api/x", { signal: controller.signal });
    assert.equal(mock.last().init.signal, controller.signal);
  });

  test("an invalid JSON body on success rejects", async () => {
    mock = mockFetch(new Response("<html>", { status: 200 }));
    await assert.rejects(request("/api/x"), SyntaxError);
  });
});

describe("request errors", () => {
  test("maps a JSON error to ApiError with status, code and extra details", async () => {
    mock = mockFetch(jsonResponse({ error: "name taken", code: "NAME_TAKEN", field: "name", max: 3 }, 409));
    const err = await request("/api/x").catch((e: unknown) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "NAME_TAKEN");
    assert.equal(err.message, "name taken");
    assert.deepEqual(err.details, { field: "name", max: 3 });
    assert.equal(err.name, "ApiError");
  });

  test("an error without code has a null code", async () => {
    mock = mockFetch(jsonResponse({ error: "nope" }, 400));
    const err = (await request("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.equal(err.code, null);
    assert.equal(err.message, "nope");
  });

  test("a non-string code or error message is ignored", async () => {
    mock = mockFetch(jsonResponse({ error: { deep: 1 }, code: 42 }, 422));
    const err = (await request("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.equal(err.code, null);
    assert.equal(err.message, "request failed (422)");
  });

  test("a non-JSON error body (a proxy's HTML page) still becomes an ApiError", async () => {
    mock = mockFetch(new Response("<h1>Bad gateway</h1>", { status: 502 }));
    const err = (await request("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 502);
    assert.equal(err.code, null);
    assert.equal(err.message, "request failed (502)");
    assert.deepEqual(err.details, {});
  });

  test("an empty error body (401) still becomes an ApiError", async () => {
    mock = mockFetch(new Response(null, { status: 401 }));
    const err = (await request("/api/auth/me").catch((e: unknown) => e)) as ApiError;
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "request failed (401)");
  });

  test("an error body that is a JSON array does not break the mapping", async () => {
    mock = mockFetch(jsonResponse(["a"], 500));
    const err = (await request("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
  });

  test("an error body that is the JSON literal null does not break the mapping", async () => {
    mock = mockFetch(new Response("null", { status: 500 }));
    const err = (await request("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.ok(err instanceof ApiError, String(err));
    assert.equal(err.status, 500);
  });

  test("a network failure becomes a NetworkError carrying the cause", async () => {
    const cause = new TypeError("fetch failed");
    mock = mockFetch(cause);
    const err = await request("/api/x").catch((e: unknown) => e);
    assert.ok(err instanceof NetworkError);
    assert.equal(err.cause, cause);
    assert.equal(err.name, "NetworkError");
  });

  test("an abort stays an AbortError, not a NetworkError", async () => {
    const abort = new DOMException("aborted", "AbortError");
    mock = mockFetch(abort);
    const err = await request("/api/x").catch((e: unknown) => e);
    assert.equal(err, abort);
    assert.ok(!(err instanceof NetworkError));
  });

  test("a DOMException that is not an abort (a timeout) is a NetworkError", async () => {
    mock = mockFetch(new DOMException("slow", "TimeoutError"));
    const err = await request("/api/x").catch((e: unknown) => e);
    assert.ok(err instanceof NetworkError);
  });
});

describe("requestText and requestBlob", () => {
  test("requestText returns the raw body, not parsed", async () => {
    mock = mockFetch(new Response("Table a {}", { status: 200 }));
    assert.equal(await requestText("/api/x/export", { query: { visual: "1" } }), "Table a {}");
    assert.equal(mock.last().url, "/api/x/export?visual=1");
  });

  test("requestText maps errors like request", async () => {
    mock = mockFetch(jsonResponse({ error: "forbidden", code: "FORBIDDEN" }, 403));
    const err = (await requestText("/api/x").catch((e: unknown) => e)) as ApiError;
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "FORBIDDEN");
  });

  test("requestBlob returns the bytes", async () => {
    mock = mockFetch(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const blob = await requestBlob("/api/x/zip");
    assert.equal(blob.size, 3);
  });

  test("requestBlob maps errors and network failures", async () => {
    mock = mockFetch(jsonResponse({ error: "gone" }, 404));
    await assert.rejects(requestBlob("/api/x/zip"), (e: unknown) => e instanceof ApiError && e.status === 404);
    mock.restore();
    mock = mockFetch(new TypeError("down"));
    await assert.rejects(requestBlob("/api/x/zip"), NetworkError);
  });
});

describe("early responses (started by index.html)", () => {
  const early = (responses: Record<string, Promise<Response>>, at = performance.now()) => {
    (globalThis as { window?: unknown }).window = { __nebulaEarly: { id: "p", at, responses, ws: null } };
  };

  test("a plain GET picks up the early response and does not call fetch", async () => {
    mock = mockFetch(jsonResponse({ from: "fetch" }));
    early({ "/api/auth/me": Promise.resolve(jsonResponse({ from: "early" })) });
    assert.deepEqual(await request("/api/auth/me"), { from: "early" });
    assert.equal(mock.calls.length, 0);
  });

  test("an early response is handed out once", async () => {
    mock = mockFetch(jsonResponse({ from: "fetch" }));
    early({ "/api/auth/me": Promise.resolve(jsonResponse({ from: "early" })) });
    await request("/api/auth/me");
    assert.deepEqual(await request("/api/auth/me"), { from: "fetch" });
    assert.equal(mock.calls.length, 1);
  });

  test("a failed early request falls back to a normal fetch", async () => {
    mock = mockFetch(jsonResponse({ from: "fetch" }));
    const failing = Promise.reject(new Error("boom"));
    failing.catch(() => {});
    early({ "/api/auth/me": failing });
    assert.deepEqual(await request("/api/auth/me"), { from: "fetch" });
    assert.equal(mock.calls.length, 1);
  });

  test("a stale early response is ignored", async () => {
    mock = mockFetch(jsonResponse({ from: "fetch" }));
    early({ "/api/auth/me": Promise.resolve(jsonResponse({ from: "early" })) }, performance.now() - 60_000);
    assert.deepEqual(await request("/api/auth/me"), { from: "fetch" });
  });

  test("a request with a query, a body, a signal or another method never uses it", async () => {
    mock = mockFetch(() => jsonResponse({ from: "fetch" }));
    const responses = () => ({ "/api/auth/me": Promise.resolve(jsonResponse({ from: "early" })) });
    early(responses());
    assert.deepEqual(await request("/api/auth/me", { query: { a: 1 } }), { from: "fetch" });
    early(responses());
    assert.deepEqual(await request("/api/auth/me", { signal: new AbortController().signal }), { from: "fetch" });
    early(responses());
    assert.deepEqual(await request("/api/auth/me", { method: "POST" }), { from: "fetch" });
    assert.equal(mock.calls.length, 3);
  });

  test("an early non-2xx response is mapped to ApiError (a 401 means signed out)", async () => {
    mock = mockFetch(jsonResponse({}));
    early({ "/api/auth/me": Promise.resolve(jsonResponse({ error: "no session", code: "UNAUTHENTICATED" }, 401)) });
    const err = (await request("/api/auth/me").catch((e: unknown) => e)) as ApiError;
    assert.equal(err.status, 401);
    assert.equal(err.code, "UNAUTHENTICATED");
  });
});
