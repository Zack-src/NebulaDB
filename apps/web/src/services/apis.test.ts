import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { jsonResponse, mockFetch } from "../test/fetchMock";
import { ApiError } from "./ApiError";
import * as authApi from "./authApi";
import * as projectsApi from "./projectsApi";
import { ACTIVITY_CATEGORIES, activityExportUrl, fetchActivity } from "./activityApi";
import { searchSchemas } from "./searchApi";
import * as seedsApi from "./seedsApi";
import * as lintApi from "./lintApi";
import * as backupsApi from "./backupsApi";
import * as shareApi from "./shareLinksApi";
import * as dbAdminApi from "./dbAdminApi";
import * as journalApi from "./connectionJournalApi";
import * as retentionApi from "./retentionApi";

let mock: ReturnType<typeof mockFetch>;
const setup = (...replies: Parameters<typeof mockFetch>) => {
  mock?.restore();
  mock = mockFetch(...replies);
  return mock;
};
afterEach(() => mock?.restore());

const ok =
  (body: unknown = {}) =>
  () =>
    jsonResponse(body);

describe("authApi", () => {
  test("login posts the credentials as JSON", async () => {
    setup(ok({ id: "u1" }));
    await authApi.login({ email: "a@b.c", password: "pw", remember: true });
    assert.equal(mock.last().url, "/api/auth/login");
    assert.equal(mock.last().init.method, "POST");
    assert.deepEqual(mock.last().json, { email: "a@b.c", password: "pw", remember: true });
  });

  test("login can answer 'MFA required' instead of a session", async () => {
    setup(ok({ mfaRequired: true, mfaToken: "tok" }));
    const result = await authApi.login({ email: "a@b.c", password: "pw", remember: false });
    assert.deepEqual(result, { mfaRequired: true, mfaToken: "tok" });
  });

  test("a wrong password surfaces the server code", async () => {
    setup(() => jsonResponse({ error: "bad credentials", code: "INVALID_CREDENTIALS" }, 401));
    await assert.rejects(
      authApi.login({ email: "a@b.c", password: "x", remember: false }),
      (e: unknown) => e instanceof ApiError && e.status === 401 && e.code === "INVALID_CREDENTIALS",
    );
  });

  test("fetchCurrentSession is a GET and rejects with a 401 when signed out", async () => {
    setup(() => jsonResponse({ error: "unauthenticated" }, 401));
    await assert.rejects(authApi.fetchCurrentSession(), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(mock.last().url, "/api/auth/me");
    assert.equal(mock.last().init.method, "GET");
  });

  test("verifyTotpLogin sends the pending token and the code", async () => {
    setup(ok({ id: "u1" }));
    await authApi.verifyTotpLogin("tok", "123456");
    assert.equal(mock.last().url, "/api/auth/login/totp");
    assert.deepEqual(mock.last().json, { mfaToken: "tok", code: "123456" });
  });

  test("logout is a bodiless POST and tolerates an empty answer", async () => {
    setup(() => new Response(null, { status: 204 }));
    assert.equal(await authApi.logout(), undefined);
    assert.equal(mock.last().init.method, "POST");
    assert.equal(mock.last().init.body, undefined);
  });

  test("revoking a session targets its id; revoke-others is a POST", async () => {
    setup(ok({ revoked: 2 }));
    await authApi.revokeSession("s-1");
    assert.equal(mock.last().url, "/api/auth/sessions/s-1");
    assert.equal(mock.last().init.method, "DELETE");
    assert.deepEqual(await authApi.revokeOtherSessions(), { revoked: 2 });
    assert.equal(mock.last().url, "/api/auth/sessions/revoke-others");
  });

  test("TOTP setup posts an empty object; disable and regenerate carry the password", async () => {
    setup(ok());
    await authApi.startTotpSetup();
    assert.deepEqual(mock.last().json, {});
    await authApi.disableTotp("pw", "111111");
    assert.equal(mock.last().url, "/api/auth/totp/disable");
    assert.deepEqual(mock.last().json, { password: "pw", code: "111111" });
    await authApi.regenerateBackupCodes("pw");
    assert.deepEqual(mock.last().json, { password: "pw" });
    await authApi.confirmTotpSetup("222222");
    assert.deepEqual(mock.last().json, { code: "222222" });
  });

  test("password reset request and confirm", async () => {
    setup(ok({ email: "a@b.c" }));
    await authApi.requestPasswordReset("a@b.c");
    assert.equal(mock.last().url, "/api/auth/password-reset/request");
    assert.deepEqual(mock.last().json, { email: "a@b.c" });
    await authApi.confirmPasswordReset("t", "newpw");
    assert.deepEqual(mock.last().json, { token: "t", password: "newpw" });
  });
});

describe("projectsApi", () => {
  test("project CRUD uses the right verbs and paths", async () => {
    setup(ok({}));
    await projectsApi.fetchProjects();
    assert.equal(mock.last().url, "/api/projects");
    await projectsApi.createProject("Shop");
    assert.deepEqual([mock.last().init.method, mock.last().json], ["POST", { name: "Shop" }]);
    await projectsApi.renameProject("p1", "Shop 2");
    assert.deepEqual(
      [mock.last().url, mock.last().init.method, mock.last().json],
      ["/api/projects/p1", "PATCH", { name: "Shop 2" }],
    );
    await projectsApi.setProjectStatus("p1", "archived");
    assert.deepEqual(mock.last().json, { status: "archived" });
    await projectsApi.deleteProjectForever("p1");
    assert.deepEqual([mock.last().url, mock.last().init.method], ["/api/projects/p1", "DELETE"]);
  });

  test("team and member grants are PUT with the permission, revoked with DELETE", async () => {
    setup(ok());
    await projectsApi.grantProjectTeam("p1", "t1", "edit");
    assert.deepEqual(
      [mock.last().url, mock.last().init.method, mock.last().json],
      ["/api/projects/p1/teams/t1", "PUT", { permission: "edit" }],
    );
    await projectsApi.revokeProjectTeam("p1", "t1");
    assert.equal(mock.last().init.method, "DELETE");
    await projectsApi.grantProjectMember("p1", "u1", "view");
    assert.deepEqual([mock.last().url, mock.last().json], ["/api/projects/p1/members/u1", { permission: "view" }]);
    await projectsApi.revokeProjectMember("p1", "u1");
    assert.equal(mock.last().url, "/api/projects/p1/members/u1");
  });

  test("restoreRevision sends a body only when restoring specific tables", async () => {
    setup(ok());
    await projectsApi.restoreRevision("p1", "r1");
    assert.equal(mock.last().url, "/api/projects/p1/revisions/r1/restore");
    assert.equal(mock.last().init.body, undefined);
    await projectsApi.restoreRevision("p1", "r1", ["t1", "t2"]);
    assert.deepEqual(mock.last().json, { tableIds: ["t1", "t2"] });
  });

  test("labelRevision can clear a label with null", async () => {
    setup(ok());
    await projectsApi.labelRevision("p1", "r1", null);
    assert.deepEqual(mock.last().json, { label: null });
  });

  test("importSource only sends dialect and baseline when given", async () => {
    setup(ok({ tables: 1 }));
    await projectsApi.importSource("p1", "Table a {}");
    assert.deepEqual(mock.last().json, { source: "Table a {}" });
    await projectsApi.importSource("p1", "SELECT", "postgres", "old text");
    assert.deepEqual(mock.last().json, { source: "SELECT", dialect: "postgres", baseline: "old text" });
    await projectsApi.importSource("p1", "s", undefined, "");
    assert.deepEqual(mock.last().json, { source: "s" }, "an empty baseline is no baseline");
  });

  test("importSource passes keepalive through for small sources", async () => {
    setup(ok({ tables: 1 }));
    await projectsApi.importSource("p1", "x", undefined, undefined, { keepalive: true });
    assert.equal(mock.last().init.keepalive, true);
  });

  test("exports read text and put options in the query", async () => {
    setup(() => new Response("-- sql", { status: 200 }));
    assert.equal(await projectsApi.exportSql("p1", "postgres"), "-- sql");
    assert.equal(mock.last().url, "/api/projects/p1/export/sql?dialect=postgres");
    await projectsApi.exportDbml("p1");
    assert.equal(mock.last().url, "/api/projects/p1/export/dbml");
    await projectsApi.exportDbml("p1", true);
    assert.equal(mock.last().url, "/api/projects/p1/export/dbml?visual=1");
    await projectsApi.exportRevisionDbml("p1", "r9");
    assert.equal(mock.last().url, "/api/projects/p1/revisions/r9/export/dbml");
  });

  test("a 403 on a project reaches the caller as ApiError with details", async () => {
    setup(() => jsonResponse({ error: "no", code: "FORBIDDEN", needed: "admin" }, 403));
    const err = (await projectsApi.fetchProject("p1").catch((e: unknown) => e)) as ApiError;
    assert.equal(err.status, 403);
    assert.deepEqual(err.details, { needed: "admin" });
  });
});

describe("activityApi", () => {
  test("filters that are empty are dropped; limit is always sent", async () => {
    setup(ok({ entries: [], nextCursor: null }));
    await fetchActivity({ category: "data", search: "", projectId: undefined });
    assert.equal(mock.last().url, "/api/admin/activity?category=data&limit=100");
  });

  test("the cursor is sent only when set (0 and null mean first page)", async () => {
    setup(ok({ entries: [], nextCursor: null }));
    await fetchActivity({}, 0);
    assert.ok(!mock.last().url.includes("cursor"));
    await fetchActivity({}, null);
    assert.ok(!mock.last().url.includes("cursor"));
    await fetchActivity({}, 42);
    assert.ok(mock.last().url.includes("cursor=42"));
  });

  test("export url carries the same filters and the format, encoded", () => {
    assert.equal(
      activityExportUrl({ search: "a&b", actorId: "u1" }, "csv"),
      "/api/admin/activity/export?search=a%26b&actorId=u1&format=csv",
    );
    assert.equal(activityExportUrl({}, "json"), "/api/admin/activity/export?format=json");
  });

  test("the category list has no duplicates", () => {
    assert.equal(new Set(ACTIVITY_CATEGORIES).size, ACTIVITY_CATEGORIES.length);
  });
});

describe("searchApi", () => {
  test("encodes the query and forwards the signal", async () => {
    setup(ok({ hits: [], truncated: false }));
    const controller = new AbortController();
    await searchSchemas("user name & id", controller.signal);
    assert.equal(mock.last().url, "/api/search?q=user+name+%26+id");
    assert.equal(mock.last().init.signal, controller.signal);
  });

  test("a superseded search rejects with an AbortError", async () => {
    setup(new DOMException("aborted", "AbortError"));
    await assert.rejects(searchSchemas("a"), (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  });
});

describe("seedsApi", () => {
  test("table ids are URL-encoded in the path", async () => {
    setup(ok({ seed: { tableId: "a/b c" } }));
    await seedsApi.fetchSeed("p1", "a/b c");
    assert.equal(mock.last().url, "/api/projects/p1/seeds/a%2Fb%20c");
  });

  test("responses are unwrapped from their envelope", async () => {
    setup(ok({ seeds: [{ tableId: "t" }] }));
    assert.deepEqual(await seedsApi.fetchSeeds("p1"), [{ tableId: "t" }]);
    setup(ok({ rows: [["id"], ["1"]] }));
    assert.deepEqual(await seedsApi.fetchSeedPreview("p1", "t", 5), [["id"], ["1"]]);
    assert.equal(mock.last().url, "/api/projects/p1/seeds/t/preview?rows=5");
    setup(ok({ results: [{ file: "a.csv" }] }));
    assert.deepEqual(await seedsApi.importSeedFolder("p1", "/data"), [{ file: "a.csv" }]);
  });

  test("saveSeed is a PUT of content and options", async () => {
    setup(ok({ seed: {} }));
    await seedsApi.saveSeed("p1", "t", { content: "a,b", options: { delimiter: ";" } as never });
    assert.equal(mock.last().init.method, "PUT");
    assert.deepEqual(mock.last().json, { content: "a,b", options: { delimiter: ";" } });
  });

  test("the preview defaults to 50 rows", async () => {
    setup(ok({ rows: [] }));
    await seedsApi.fetchSeedPreview("p1", "t");
    assert.ok(mock.last().url.endsWith("?rows=50"));
  });

  describe("uploadSeedFile (XMLHttpRequest)", () => {
    class FakeXhr {
      static last: FakeXhr;
      method = "";
      url = "";
      headers: Record<string, string> = {};
      sent: unknown;
      status = 200;
      responseText = "";
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      onload?: () => void;
      onerror?: () => void;
      constructor() {
        FakeXhr.last = this;
      }
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      send(body: unknown) {
        this.sent = body;
      }
    }
    const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    afterEach(() => {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
    });
    const install = () => {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    };
    const file = {} as File;

    test("PUTs the raw file with CSV type and encoded options, reports progress, resolves", async () => {
      install();
      const progress: [number, number][] = [];
      const promise = seedsApi.uploadSeedFile("p1", "t 1", file, { delimiter: ";" } as never, (s, t) =>
        progress.push([s, t]),
      );
      const xhr = FakeXhr.last;
      assert.equal(xhr.method, "PUT");
      assert.equal(xhr.url, "/api/projects/p1/seeds/t%201/file");
      assert.equal(xhr.headers["Content-Type"], "text/csv");
      assert.deepEqual(JSON.parse(decodeURIComponent(xhr.headers["x-seed-options"])), { delimiter: ";" });
      assert.equal(xhr.sent, file);
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 7, total: 0 });
      assert.deepEqual(progress, [[5, 10]]);
      xhr.responseText = JSON.stringify({ total: 3 });
      xhr.onload?.();
      assert.deepEqual(await promise, { total: 3 });
    });

    test("options null sends no options header", () => {
      install();
      void seedsApi.uploadSeedFile("p1", "t", file, null, () => {});
      assert.equal("x-seed-options" in FakeXhr.last.headers, false);
    });

    test("a failed upload becomes an ApiError with code and details", async () => {
      install();
      const promise = seedsApi.uploadSeedFile("p1", "t", file, null, () => {});
      FakeXhr.last.status = 413;
      FakeXhr.last.responseText = JSON.stringify({ error: "too big", code: "TOO_LARGE", limit: 5 });
      FakeXhr.last.onload?.();
      await assert.rejects(promise, (e: unknown) => {
        assert.ok(e instanceof ApiError);
        assert.deepEqual([e.status, e.code, e.message, e.details], [413, "TOO_LARGE", "too big", { limit: 5 }]);
        return true;
      });
    });

    test("a non-JSON failure still rejects with the status", async () => {
      install();
      const promise = seedsApi.uploadSeedFile("p1", "t", file, null, () => {});
      FakeXhr.last.status = 502;
      FakeXhr.last.responseText = "<html>";
      FakeXhr.last.onload?.();
      await assert.rejects(promise, (e: unknown) => e instanceof ApiError && e.message === "request failed (502)");
    });

    test("a JSON null failure body still rejects with an ApiError", async () => {
      install();
      const promise = seedsApi.uploadSeedFile("p1", "t", file, null, () => {});
      FakeXhr.last.status = 500;
      FakeXhr.last.responseText = "null";
      FakeXhr.last.onload?.();
      await assert.rejects(promise, (e: unknown) => e instanceof ApiError && e.status === 500);
    });

    test("a network error rejects with a NetworkError", async () => {
      install();
      const promise = seedsApi.uploadSeedFile("p1", "t", file, null, () => {});
      FakeXhr.last.onerror?.();
      await assert.rejects(promise, (e: unknown) => e instanceof Error && e.name === "NetworkError");
    });
  });
});

describe("lintApi", () => {
  test("choosing a preset or the default sends presetId, null included", async () => {
    setup(ok({}));
    await lintApi.chooseLintPreset("p1", "pr1");
    assert.deepEqual(
      [mock.last().url, mock.last().init.method, mock.last().json],
      ["/api/projects/p1/lint", "PUT", { presetId: "pr1" }],
    );
    await lintApi.chooseLintPreset("p1", null);
    assert.deepEqual(mock.last().json, { presetId: null });
  });

  test("preset ids are encoded and responses unwrapped", async () => {
    setup(ok({ preset: { id: "a b" } }));
    assert.deepEqual(await lintApi.updateLintPreset("a b", { name: "n" }), { id: "a b" });
    assert.equal(mock.last().url, "/api/admin/lint-presets/a%20b");
    await lintApi.applyLintPreset("a/b", ["p1"]);
    assert.equal(mock.last().url, "/api/admin/lint-presets/a%2Fb/apply");
    assert.deepEqual(mock.last().json, { projectIds: ["p1"] });
  });

  test("setDefaultLintPreset(null) removes the default", async () => {
    setup(ok({ defaultId: null }));
    await lintApi.setDefaultLintPreset(null);
    assert.deepEqual(mock.last().json, { id: null });
  });
});

describe("backupsApi", () => {
  test("startBackup unwraps the backup and defaults to an empty body", async () => {
    setup(ok({ backup: { id: "b1" } }));
    assert.deepEqual(await backupsApi.startBackup("c1"), { id: "b1" });
    assert.equal(mock.last().url, "/api/admin/connections/c1/backups");
    assert.deepEqual(mock.last().json, {});
  });

  test("pin, cancel, delete and restore", async () => {
    setup(ok({ result: { restored: 3 } }));
    await backupsApi.setBackupPinned("b1", true);
    assert.deepEqual(
      [mock.last().url, mock.last().init.method, mock.last().json],
      ["/api/admin/backups/b1", "PATCH", { pinned: true }],
    );
    await backupsApi.cancelBackup("b1");
    assert.equal(mock.last().url, "/api/admin/backups/b1/cancel");
    await backupsApi.deleteBackup("b1");
    assert.equal(mock.last().init.method, "DELETE");
    assert.deepEqual(await backupsApi.restoreBackup("b1", { confirmName: "prod" }), { restored: 3 });
    assert.deepEqual(mock.last().json, { confirmName: "prod" });
  });

  test("the restore refusal keeps its code", async () => {
    setup(() => jsonResponse({ error: "name mismatch", code: "CONFIRM_NAME_MISMATCH" }, 400));
    await assert.rejects(
      backupsApi.restoreBackup("b1", { confirmName: "x" }),
      (e: unknown) => e instanceof ApiError && e.code === "CONFIRM_NAME_MISMATCH",
    );
  });

  test("backupDownloadUrl is a plain link", () => {
    assert.equal(backupsApi.backupDownloadUrl("b1"), "/api/admin/backups/b1/download");
  });
});

describe("shareLinksApi", () => {
  test("create posts the input; revoke deletes by id", async () => {
    setup(ok({ link: {}, token: "tok" }));
    const result = await shareApi.createShareLink("p1", { label: "L", shows: "both", expiresInDays: 7 });
    assert.equal(result.token, "tok");
    assert.deepEqual(mock.last().json, { label: "L", shows: "both", expiresInDays: 7 });
    await shareApi.revokeShareLink("p1", "l1");
    assert.deepEqual([mock.last().url, mock.last().init.method], ["/api/projects/p1/share-links/l1", "DELETE"]);
  });

  test("setShareLinksEnabled returns the stored flag", async () => {
    setup(ok({ enabled: false }));
    assert.equal(await shareApi.setShareLinksEnabled(false), false);
    assert.deepEqual(mock.last().json, { enabled: false });
  });

  test("shareUrl joins origin and token", () => {
    assert.equal(shareApi.shareUrl("abc", "https://x.test"), "https://x.test/share/abc");
  });
});

describe("dbAdminApi and connectionJournalApi", () => {
  test("deleteAdminConnection adds force=true only when forced", async () => {
    setup(ok());
    await dbAdminApi.deleteAdminConnection("c1", false);
    assert.equal(mock.last().url, "/api/admin/connections/c1");
    await dbAdminApi.deleteAdminConnection("c1", true);
    assert.equal(mock.last().url, "/api/admin/connections/c1?force=true");
  });

  test("explorer calls skip undefined database/schema", async () => {
    setup(ok({ tables: [], schemas: [] }));
    await dbAdminApi.fetchTables("c1");
    assert.equal(mock.last().url, "/api/connections/c1/tables");
    await dbAdminApi.fetchTables("c1", "db", "public");
    assert.equal(mock.last().url, "/api/connections/c1/tables?database=db&schema=public");
    await dbAdminApi.fetchSchemas("c1", "db");
    assert.equal(mock.last().url, "/api/connections/c1/schemas?database=db");
  });

  test("fetchEditableRows spreads the table ref into the query with paging", async () => {
    setup(ok({}));
    await dbAdminApi.fetchEditableRows("c1", { database: "d", schema: "s", table: "t" } as never, 100, 200);
    const url = new URL(mock.last().url, "http://x");
    assert.equal(url.pathname, "/api/connections/c1/editable-rows");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      database: "d",
      schema: "s",
      table: "t",
      limit: "100",
      offset: "200",
    });
  });

  test("applyRowEdits only confirms the write when executing", async () => {
    setup(ok({}));
    await dbAdminApi.applyRowEdits("c1", { table: "t" } as never, [], false);
    assert.equal("confirmWrite" in (mock.last().json as object), false, "undefined drops out of JSON");
    assert.equal((mock.last().json as { execute: boolean }).execute, false);
    await dbAdminApi.applyRowEdits("c1", { table: "t" } as never, [], true);
    assert.equal((mock.last().json as { confirmWrite: boolean }).confirmWrite, true);
  });

  test("runAdminQuery unwraps the result and merges options into the body", async () => {
    setup(ok({ result: { rows: [] } }));
    assert.deepEqual(await dbAdminApi.runAdminQuery("c1", "select 1", { readOnly: true, maxRows: 10 }), { rows: [] });
    assert.deepEqual(mock.last().json, { sql: "select 1", readOnly: true, maxRows: 10 });
  });

  test("testAdminConnection sends the id next to the config", async () => {
    setup(ok({}));
    await dbAdminApi.testAdminConnection({ name: "n" } as never, "c1");
    assert.deepEqual(mock.last().json, { name: "n", id: "c1" });
  });

  test("journal stats: days 0 means every day kept, so it is left out", async () => {
    setup(ok({ stats: [] }));
    await journalApi.fetchQueryStats("c1", { days: 0, sort: "total" as never });
    assert.equal(mock.last().url, "/api/admin/connections/c1/query-stats?sort=total");
    await journalApi.fetchQueryStats("c1", { days: 7, sort: "total" as never });
    assert.equal(mock.last().url, "/api/admin/connections/c1/query-stats?sort=total&days=7");
  });

  test("index suggestions and activity build their optional filters", async () => {
    setup(ok({}));
    await journalApi.fetchIndexSuggestions("c1", { days: 0 });
    assert.equal(mock.last().url, "/api/admin/connections/c1/index-suggestions");
    await journalApi.fetchIndexSuggestions("c1", { days: 3, database: "d" });
    assert.equal(mock.last().url, "/api/admin/connections/c1/index-suggestions?days=3&database=d");
    await journalApi.fetchDbActivity("c1", { days: 1, outside: true });
    assert.equal(mock.last().url, "/api/admin/connections/c1/activity?days=1&outside=1");
    await journalApi.fetchDbActivity("c1", { days: 1, outside: false });
    assert.equal(mock.last().url, "/api/admin/connections/c1/activity?days=1");
  });
});

describe("retentionApi", () => {
  test("fetchRetention unwraps the journals", async () => {
    setup(ok({ journals: [{ key: "audit_log" }] }));
    const journals = await retentionApi.fetchRetention();
    assert.equal(mock.last().url, "/api/admin/retention");
    assert.equal(journals[0].key, "audit_log");
  });

  test("the preview is a GET on the journal's key", async () => {
    setup(ok({ key: "audit_log", rows: 12 }));
    await retentionApi.fetchRetentionPreview("audit_log");
    assert.equal(mock.last().url, "/api/admin/retention/audit_log/preview");
    assert.equal(mock.last().init.method, "GET");
  });

  test("setRetention puts the value, with confirm only when given, and null resets", async () => {
    setup(ok({ journal: { key: "audit_log", value: 30 } }), ok({ journal: { key: "audit_log" } }));
    const journal = await retentionApi.setRetention("audit_log", 30, true);
    assert.equal(journal.value, 30);
    assert.equal(mock.last().init.method, "PUT");
    assert.deepEqual(mock.last().json, { value: 30, confirm: true });
    await retentionApi.setRetention("audit_log", null);
    assert.deepEqual(mock.last().json, { value: null });
  });

  test("purgeRetention sends the key back as confirmation", async () => {
    setup(ok({ key: "audit_log", deleted: 3 }));
    const result = await retentionApi.purgeRetention("audit_log");
    assert.equal(mock.last().url, "/api/admin/retention/audit_log/purge");
    assert.equal(mock.last().init.method, "POST");
    assert.deepEqual(mock.last().json, { confirm: "audit_log" });
    assert.equal(result.deleted, 3);
  });

  test("a missing confirmation surfaces the server code", async () => {
    setup(() => jsonResponse({ error: "confirm", code: "RETENTION_CONFIRM_REQUIRED" }, 400));
    await assert.rejects(
      retentionApi.setRetention("audit_log", 30),
      (e: unknown) => e instanceof ApiError && e.code === "RETENTION_CONFIRM_REQUIRED",
    );
  });
});
