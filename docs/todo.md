# AthanorDB — TODO

DBML-native, self-hosted, multi-user, versioned, visual editor.

Legend: `[ ]` todo, `[~]` in progress/partially done, `[x]` done. Every open item follows
the same shape — **What** it means, concretely, **How** to build it (files, approach), and
**Blocked by** when something else has to land first. Effort tags: **S** (hours), **M** (a
day or two), **L** (about a week), **XL** (a project of its own).

**Cleaned up 2026-08-20.** This file had grown into a session-by-session changelog —
closed items carried full paragraphs of implementation and verification narrative that
made it hard to see what's actually left. Closed items below are now one line each
(title + date); the detailed "how it was built and verified" prose is still recoverable
with `git log --follow -p -- docs/todo.md` for any item that needs it. Duplicate/overlapping
open items were merged into one (noted inline where that happened); items superseded by
later work were dropped. **Phase numbers are kept stable even for fully-closed phases** —
`v1-roadmap.md` and several source comments (`crypto.ts`, `hostGuard.ts`,
`ErrorBoundary.tsx`, `yjsBinding.ts`) point at specific phase numbers, and renumbering
would make those stale.

**Revisited 2026-08-21** against the running codebase (full test suite, a full build, git
log, `npm audit`) rather than re-reading only: closed two items that had already landed
but weren't marked here (the DBML-panel data-loss fix, the `@dbml/core` upgrade),
corrected file-size references that had drifted since the last measurement, and folded in
the 2026-08-20 perf/concurrency docs. `docs/refactor-plan.md` was deleted — every item in
it was done (§5 said so already); recover it with `git log --follow -p -- docs/refactor-plan.md`
if needed. `docs/v1-roadmap.md` and `docs/user-guide.md` got the same pass.

**Same session, second pass:** the whole Phase 23 "Code health & tooling" set plus Phase
24's metrics/error-tracking/logging items and Phase 25's versioning item were actually
built (not just re-audited) — `room.ts` split, the file-size watchlist's two closest
entries split, an in-app component catalogue, `/api/metrics`, an aggregated error log
(server + client, with an admin UI), request-id-aware logging, log rotation, and a
documented versioning decision. Verified end to end after: full build, full lint, full
test suite (275 tests, 0 failures) and `check:circular`, all green.

Phases 0–1, 3–5, 7 were closed and pruned before this file's history starts. Phases 2, 8,
9, 12, 18, 26 are fully closed as of this cleanup and pruned the same way (none of them
are pointed at by number from outside this file): Phase 2's DBML/SQL import is done for
Postgres/MySQL/SQL Server (SQLite import is a scope decision, not a todo — see *Open
decisions*); Phase 8's theme item was superseded by Phase 22 (light theme shipped); Phase
9's "live DB connection" stretch goal was superseded by Phase 27 (built); Phase 12, 18 and
26 finished with no open remainder. Phase 4's old toolbar item is likewise done (`RefEdge.tsx`
is a real custom edge, superseded by the Phase 17 toolbar redesign) — no phase 4 section
exists to restore.

---

## Phase 6 — Multi-user editing

- [x] **DBML-panel resync was silently deleting concurrent edits** — found and fixed
  2026-08-20, verified with two real browser sessions on one project. Two distinct bugs:
  the panel treated the app's own document→buffer mirroring as a user keystroke, so any
  canvas edit by anyone made *every* connected client's panel re-POST the whole schema
  600ms later; and `/import` replaced the document from a buffer that could be seconds
  stale, deleting anything another user had added meanwhile (reproduced: a column added on
  the canvas vanished while another user typed DBML). Fixed with a `documentSync`
  transaction annotation the change listener ignores, plus a three-way merge
  (`preserveConcurrentAdditions`, new in `packages/dbml-engine`) that keeps entities absent
  from *both* the buffer and its baseline instead of treating "absent" as "deleted". 5 new
  tests (`concurrentEdits.test.ts`). Detail in `docs/perf/multiuser-concurrency-2026-08-20.md`.
- [~] **Field-level CRDT merge within one table** — **S-M**, low priority. **What:** two
  users editing different fields of the *same* table (or the same field via DBML vs.
  canvas) at the same time still last-write-wins instead of merging per field — confirmed
  by the 2026-08-20 verification above as the one known remaining gap, not just a
  theoretical concern anymore. **How:** split each table's fields into individual Yjs
  sub-entries (e.g. one `Y.Map` per table instead of one opaque JSON blob) — touches
  `packages/shared/src/yjsBinding.ts`, `Room`'s watched-collection logic in
  `apps/server/src/realtime/room.ts`, and every web mutation that currently does
  `tablesMap.set(id, {...current, ...patch})`. Revisit if this specific collision (not the
  resync bug above, which is fixed) gets reported in practice.
- [x] **Committed multi-user regression test** — done 2026-08-21:
  `apps/server/src/modules/projects/routes/importExport.concurrency.test.ts`, four tests
  hitting the real `POST /api/projects/:id/import` route against a real `Room`'s live doc
  (a concurrent canvas edit written straight to `room.doc`, the same way an incoming
  WebSocket update would apply). Covers the exact 2026-08-20 scenario in both directions
  (a canvas addition surviving a stale DBML resync, and vice versa), confirms a real
  deletion still applies, and confirms a baseline-less import still replaces everything.
  This is the route-level integration test the original throwaway Playwright verification
  never left behind — `preserveConcurrentAdditions` itself already had unit tests
  (`concurrentEdits.test.ts`), but nothing exercised the actual route before this.

## Phase 10 — Packaging & deployment

- [x] **Verify the Docker build on a real Docker daemon** — done 2026-08-21, and it found a
  real bug the first time it ran: Docker Desktop came up on the same machine mid-session,
  so `docker compose up --build` finally ran against a live daemon instead of failing to
  connect. The container built, then **crash-looped with SIGSEGV** (exit 139) on every
  start — the `Dockerfile` pinned `node:20-bookworm-slim` while `better-sqlite3@13` (and
  `package.json`'s own `engines`) require Node ≥22; `npm ci` even printed the `EBADENGINE`
  warnings for it, easy to miss in a wall of apt output. Fixed: `FROM node:22-bookworm-slim`.
  Re-verified after the fix, end to end: container starts `(healthy)`, `/api/health` returns
  `200`, an import made <200ms before a real `docker compose stop` (genuine `SIGTERM`, not
  simulated) survived — logs show `SIGTERM received` → `flushed 1 room snapshot(s)` →
  `shutdown complete` — and the data was still there after a full `docker compose down` +
  `up` (new container, same named volume). Also closes the SIGTERM item below — same test.

## Phase 11 — Testing & docs

- [x] Unit tests for `dbml-engine`/`shared` — done, `npm test`.
- [x] **Server integration tests (REST + WS)** — done 2026-08-21. `Room`/WS is fully
  covered (`yjs/room.test.ts`); `app.test.ts` covers the highest-risk REST surface (auth,
  CSRF, rate limiting, permission gating, `/api/metrics`, `/api/errors`) via `buildApp()` +
  `.inject()`. The remaining route modules now each have their own `routes.test.ts`,
  same pattern: `modules/invitations/`, `modules/teams/`, `modules/convert/`,
  `modules/users/` (both `account.ts` and `admin.ts`), and `modules/projects/routes.test.ts`
  for the three project route files `app.test.ts` didn't already cover
  (`importExport.ts`, `revisions.ts`, `teams.ts` — `crud.ts` was already there). 22 new
  tests; server suite is now 150 (was 128), all green. One real gotcha hit and fixed along
  the way: any test that touches a `Room` (via `getRoom`, directly or through a route) has
  to call `closeAllRooms()` in its `finally` alongside `app.close()`, or the room's
  `Awareness` timer keeps that test file's process alive — it doesn't fail, it just never
  exits, so a missing cleanup shows up as the *whole test run* hanging, not a red test.
- [~] **Browser-based test coverage (canvas, DBML sync, components, E2E)** — **L**, one of
  the three gaps closed 2026-08-21. **The decision**: Playwright (`playwright-core`,
  already a dependency for `scripts/bench-web.mjs`), against the real built app — not
  jsdom + a component-testing library. **Done**: the one E2E flow this item asked for
  (create project → add a table on the canvas → reload → verify persistence) is now a
  committed, passing test — `apps/web/e2e/project-lifecycle.e2e.ts`, run with
  `npm run test:e2e`, deliberately outside `npm test` (needs a build and a browser first).
  Getting it green surfaced and fixed two real, separate bugs on the way: `fetch()` refuses
  to connect to port 4190 (it's on the Fetch spec's forbidden-ports list — ManageSieve,
  RFC 5804) and the project list's own search `<input>` isn't the same input as a
  freshly-created card's rename field, so a naive "the first input on the page" selector
  silently targets the wrong element. Both are noted in the test file's own comments.
  **Still open**: the canvas (React Flow nodes, drag/selection/Yjs-binding hooks), every
  other React component, and Phase 17's plugin registry/sandbox-Worker path all still have
  zero test coverage — this closed the E2E piece specifically, not component coverage in
  general. Spread into that from here rather than re-deciding the tooling.
- [x] User docs (`docs/user-guide.md`) — done.
- [x] Contributing guide (`CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`) — done.

## Phase 13 — Security hardening

- [x] Rate limiting, scrypt cost, max password length, session cleanup, secure-cookie
  guard, CSRF origin check, invitation-accept TOCTOU race, entity-count limits, email
  validation, unused monaco deps removed — all done 2026-07-31 through 2026-08-09.
- [~] **Invitation delivery is manual (no email)** — see Phase 20's transactional-email
  item, the actual blocker; this is the same task, not a separate one.

## Phase 14 — Feature completeness (canvas / DBML)

Closed 2026-08-09/2026-08-15: `TableGroup` visual editor, Enum visual editor, index/composite-PK
visual editor, canvas search, WebSocket reconnect logic, large-schema rendering safeguards,
remote-cursor and remote-selection presence. Kept only because `v1-roadmap.md` points at
this phase by number.

## Phase 15 — Reliability & operations

- [x] Graceful shutdown, global error guard, real migration system, one-way→two-way
  backup/restore, request/frame size limits, startup config validation, non-root Docker
  user, the room-eviction Awareness-timer memory leak — all done 2026-07-31 through
  2026-08-09.
- [x] **Verify graceful shutdown against a real SIGTERM** — done 2026-08-21, as part of the
  Docker verification above: `docker compose stop` against the real container sends a
  genuine `SIGTERM` (unlike the Windows dev machine, where Node never receives one), and
  the logs confirm the exact sequence — `SIGTERM received` → `flushed N room snapshot(s)`
  → `shutdown complete` — for a room edited under 200ms earlier, well inside the 2s
  debounce window this item was worried wouldn't flush in time. It did.

## Phase 16 — Testing, docs & dev experience

- [x] Lint clean and CI-enforced, CI pipeline, README auth docs, LICENSE — all done
  2026-07-31 through 2026-08-08.
- [~] **Route-level test coverage for auth/teams/invitations** — **S**. Password hashing,
  sessions and permission checks are covered; `routes/{auth,invitations,teams,users}.ts`
  themselves (the HTTP layer, not the logic they call) are not. Same merge as Phase 11 —
  extend `app.test.ts`'s pattern.
- [~] **`apps/web` test coverage** — pure-logic modules (autoLayout, refGeometry,
  DBML symbols, awareness colour) are covered; the canvas/components/DBML-sync-end-to-end
  gap is the same one tracked under Phase 11's browser-test-tooling item — not repeated
  here.
- [x] **Upgrade `@dbml/core`** — done 2026-08-14 (`ee496aa`, part of a full dependency
  refresh): 3.x → 10.1.0, seven major versions, all `dbml.test.ts`/`roundtrip.test.ts`
  cases passing unchanged. `toProject`'s raw/untyped reads off `@dbml/core`'s parse output
  are still there (that's inherent to the approach, not a leftover of the old version) —
  fine as long as the roundtrip suite keeps gating any future bump. Vite was bumped to 8
  (rolldown-vite) in the same pass, which also closed the `esbuild`/`vite` dev-server
  advisory `v1-roadmap.md` §1 used to flag — `npm audit` reports 0 vulnerabilities as of
  2026-08-21.

## Phase 17 — Plugin system

- [x] Plugin runtime (sandboxed Worker), built-ins on the plugin API, example plugin,
  plugin manager UI, Figma-style toolbar, settings/persisted state, canvas-command
  selection context, plugin-defined shortcuts, source download — all done 2026-08-08.
- [ ] **Plugin-provided UI** — **L**, speculative. What: the Figma model — a plugin renders
  its own HTML in a sandboxed iframe panel, talking over `postMessage`, instead of only a
  declarative settings form. How: needs its own security pass before design; not worth
  building until a real plugin actually needs more than a settings form (none has yet).
- [ ] **Server-installed / team-shared plugins** — **M**, deliberately deferred. What:
  plugins live in one browser's `localStorage` today, so a team can't standardise on one.
  Why deferred: would mean the server storing third-party code and every user of an
  instance inheriting an admin's install decision — a real trust-model change, not a small
  add. Revisit if a team actually asks for this.
- [ ] **Plugin publishing/discovery** — **M**. Blocked by the item above — no manifest URL,
  registry, or update check exists; sharing a plugin today means sending a `.js` file.
- [~] Plugin testing gap folds into Phase 11's browser-test-tooling item (the registry is
  `localStorage`-backed, the sandbox host needs a real Worker) — not a separate item.

## Phase 19 — Security hardening for professional use

- [x] Session revocation, account disable/delete, `canWrite` live re-evaluation, audit log,
  per-account project cap, account lockout, `npm audit` CI gate, documented secret
  management, TOTP 2FA — all done 2026-08-09 through 2026-08-15.
- [ ] **Self-service password reset** — **M**. What: `PATCH /api/users/:id/password` is
  admin-only today; a user who forgets their password is stuck until one is available. How:
  `routes/invitations.ts` is the right template — single-use token, expiry, an
  `accepted_at`-style claim inside a transaction. **Blocked by:** Phase 20's transactional
  email — do them together, a reset link with no delivery mechanism doesn't help anyone.
- [ ] **Passkeys / WebAuthn** — **L**. TOTP already covers the shorter 2FA effort; passkeys
  are the unbuilt remainder, not urgent.

## Phase 20 — Accounts & onboarding

- [x] Configurable session length — done 2026-08-09.
- [ ] **Transactional email** — **M**. The actual blocker behind self-service password
  reset (Phase 19), invitation delivery (Phase 13) and notifications (below). **How:** an
  SMTP client (e.g. `nodemailer`), config via `ATHANORDB_SMTP_*` env vars following the
  same validate-at-boot pattern `config.ts` already uses for everything else, and templates
  for invite/reset emails. **Verify against:** a real SMTP target or an Ethereal-style test
  account before shipping — this environment has never had one, which is why it's stayed
  deferred.
- [ ] **Notifications** — **M**. What: nothing tells a user they were added to a
  project/team, or that someone replied to their comment thread. **Blocked by:** the email
  item above.
- [ ] **Per-project/team roles beyond view/edit/administrator** — **M**, only if actually
  wanted. What: no "can invite but not delete", no team-level role distinct from the
  project-level grant. Adequate for V1 — revisit on real demand, not speculatively.

## Phase 21 — Product features & integrations

- [ ] **Public API** — **L**. Hard prerequisite for webhooks, CI integration (Phase 27's
  Phase E) and the mentions/notifications item below. The REST routes exist and are stable
  in practice, but are cookie-authenticated, undocumented and unversioned. **How:** API
  keys (hashed at rest, scoped, rotatable, revocable — design *with* the API, not after), a
  `/api/v1` surface, per-key rate limits. `settings/SettingsTabContent.tsx`'s billing tab
  today just says plainly that no public API or API key exists yet (the old fake input
  field was removed) — building this means adding a real one, not wiring up a placeholder.
- [ ] **OpenAPI schema** — **M**. Pairs with the item above — Fastify's route schemas plus
  `@fastify/swagger` would generate it from the definitions instead of a hand-maintained doc.
- [ ] **Webhooks** — **M**. "Schema changed" → Slack/Discord/custom endpoint. **Blocked by:**
  the API's auth model. Needs delivery retries and a signed payload.
- [ ] **Project templates** — **M**. Every new project starts empty. **How:** cheap on top
  of the existing DBML import path — a template is just a `.dbml` string plus a small
  gallery UI (e-commerce, multi-tenant SaaS, auth/RBAC).
- [ ] **Cross-project diff** — **M**, ~80% of the logic already exists. `diff.ts` diffs two
  states of *one* project for the history panel; pointing it at two different projects
  (staging vs prod) is mostly UI plus a project-picker.
- [ ] **Global multi-project search** — **S-M**. Search exists inside one project (canvas
  Ctrl+F) and over the project list, not "find this table across all my projects". **How:**
  a server-side index, or a scan over stored snapshots if an index is overkill at current
  scale.
- [ ] **Comment mentions/notifications** — **M**. `CommentThread.tsx` supports threads but
  not `@user`. **Blocked by:** the email/notification work above.
- [ ] **Export to other ecosystems** (Prisma schema, TypeORM entities, GraphQL SDL, JSON
  Schema) — **M each, as plugins**, deliberately not core. The plugin API already covers
  exactly this shape (the SQLite exporter ships as the example plugin); shipping two or
  three of these is the strongest argument for the plugin system's existence.

## Phase 22 — UX, theming & accessibility

- [x] Light theme, first-run onboarding (deliberately not built), error boundary,
  loading-state placeholders — done 2026-08-09 through 2026-08-15.
- [ ] **Landing page and app are visually out of step** — **M**. The landing page (scroll
  reveals, kinetic type, bento grid) reads as a step up from the plainer dashboard/editor —
  a prospect clicking through lands on a downgrade. **How:** share the same
  hover/transition primitives across `ui/Button.tsx`/`Card.tsx` so the basic
  micro-interactions match; doesn't need the full landing-page treatment everywhere.
- [ ] **Mobile/tablet: decide, don't drift** — **S** to document, **XL** to actually build.
  React Flow plus the DBML panel assume a wide pointer-driven screen. Schema modelling is
  rarely a phone task — the honest move is probably declaring desktop-only in the README
  and on the landing page rather than half-building responsive support.
- [ ] **Accessibility audit** — **M-L**. No systematic check of contrast, keyboard
  navigation or screen-reader behaviour. Forms/modals/contrast are tractable; the React
  Flow canvas will stay hard regardless — say so plainly rather than claim coverage.

## Phase 23 — Code health & tooling

- [x] Bundle-size code-splitting, i18n unified to French, Prettier CI gate,
  circular-dependency lint, complexity lint, the four hook-adoption cleanups
  (`useDraftValue`/`useDismissablePopover`/`useEscapeKey`/typed `localStorage` helpers), a
  "reach for this before writing that" table in `CONTRIBUTING.md` — done 2026-08-08 through
  2026-08-15.
- [x] **Component catalogue** — done 2026-08-21, as an in-app page rather than Storybook
  (`components/dev/ComponentCatalogue.tsx`, routed at `/#components`, same
  lazy-loaded-outside-auth shape as the `#bench` perf harness) — every `ui/` primitive,
  every variant, both themes, on one screen. Documented in `CONTRIBUTING.md`'s new
  "Dev-only routes" section.
- [~] Web test coverage beyond pure logic — same gap as Phase 11's browser-test-tooling
  item, not repeated here.
- [x] **Split `room.ts`** — done 2026-08-21: 512 → 402 lines. Two genuinely separable
  pieces came out clean — `realtime/roomRegistry.ts` (the room `Map` + free functions:
  `getRoom`/`closeAllRooms`/etc., zero coupling to `Room` internals) and
  `realtime/room/limits.ts` (`enforceLimits`, a near-pure function over `doc` +
  `pendingChecks`). Deviated from the plan's `awareness.ts`/`connection.ts` split on
  purpose: on inspection those two are the *same* concern here (the awareness listener
  mutates the same `conns` map `receive()` reads), and forcing them apart would have added
  cross-file indirection instead of removing coupling. `yjs/room.test.ts` and the full
  server suite (128 tests) pass unchanged.
- [x] **File-size watchlist, first pass** — done 2026-08-21: `CanvasArea.tsx` 490 → 396
  lines (`useCollaboratorCursor.ts`, `useCanvasDeleteKey.ts`, `canvasMinimapColor.ts`
  extracted — each a real, bounded concern, not an arbitrary split) and `ProjectEditor.tsx`
  462 → 379 lines (`useCanvasCommandRunner.ts` — status line, command execution, the
  auto-layout/group-tables buttons, and the global plugin-shortcut binding, all one
  concern that component only ever *triggered*). Found and fixed a real duplication in the
  process: `DbmlPanel.tsx` and `ProjectEditor.tsx` each hand-rolled the same "transient
  status line with its own timer" state — now `hooks/useFlashMessage.ts`, added to
  `CONTRIBUTING.md`'s reach-for-this table. Still open, unchanged by this pass:
  `editor/dbml/language.ts` (401 l.), `dbml-engine/src/dbml.ts` (442 l.),
  `plugins/registry.ts` (389 l.), `editor/dbml/searchPanel.ts` (372 l.),
  `editor/nodes/table/TableSettingsPopover.tsx` (320 l.) — none over 500, do
  opportunistically.

## Phase 24 — Observability & operations

- [x] Real `/api/health` (DB check, room count, uptime, 503 on failure), scheduled backups
  with retention, single-instance Docker Compose documented — done 2026-08-09.
- [x] **Logging: request-id correlation + rotation guidance** — done 2026-08-21, with an
  honest limit stated rather than overclaimed. `Room`'s `console.*` calls now go through a
  `RoomLogger` interface (`realtime/room/logger.ts`) set to `app.log` at boot —
  structured/JSON, a `room` field on every line, respects `ATHANORDB_LOG_LEVEL`. **Not** a
  per-request id though: a `Room` outlives any single request (many connections and REST
  calls touch the same one over its lifetime), so there's no one request to tag those
  lines with — said explicitly in the code rather than pretended otherwise. Where a line
  *does* map to exactly one request (the WS route's join/leave in `app.ts`), it now uses
  that connection's own `req.log`, which does carry a real `reqId`. Rotation:
  `docker-compose.yml` now sets the `json-file` driver with a cap (Docker's own default is
  uncapped and grows the host disk forever); bare-process/systemd guidance is in the
  README's new "Logs" section.
- [x] **Metrics endpoint** — done 2026-08-21: `GET /api/metrics`, Prometheus text format —
  room/connection counts (new `Room.connectionCount()` + `roomRegistry.totalConnectionCount()`),
  hot-path timing from the existing `infrastructure/perf.ts` (`persistence.saveSnapshot`'s
  stats *are* the snapshot-write latency this item asked for — it was already
  instrumented, just never exposed), error counts since boot. No auth, same reasoning as
  `/api/health`. See `infrastructure/metrics.ts`.
- [x] **Error tracking** — done 2026-08-21. New `error_log` SQLite table (migration 14,
  row-capped at 2000 rather than date-retained — a debugging aid, not a compliance trail
  like `audit_log`), written to by the Fastify error handler, `uncaughtException`/
  `unhandledRejection`, and a new `POST /api/errors/client` that `ErrorBoundary.tsx` now
  calls on every caught render crash (best-effort, never throws back into the boundary
  that's already handling one, never awaited). Read via `GET /api/errors` (admin-only) and
  a new _Admin console → Errors_ tab, sibling to the audit log tab. The client side had
  nothing at all before this. 2 new tests in `app.test.ts`.

## Phase 25 — Documentation, compliance & release process

- [x] GDPR export/deletion/retention, self-hosted Google Fonts, `SECURITY.md`, reverse-proxy
  deployment guidance — done 2026-08-09.
- [~] **Versioning scheme / git tags** — decided 2026-08-21, documented in `CHANGELOG.md`'s
  new "Versioning" section: SemVer, staying `0.y.z` until the V1 checklist in
  `v1-roadmap.md` clears, then `1.0.0`. **Follow-through not done**: no version bump, no
  tag yet — cutting the actual first tagged release (moving `CHANGELOG.md`'s `[Unreleased]`
  entries under a dated heading, `npm version` across every workspace, `git tag`) is a
  deliberate release action for whoever decides the current state is release-worthy, not
  something to do unilaterally mid-cleanup.

## Phase 27 — Live database link & deployment

From `v1-roadmap.md` §7 — connects a project to a real database: read-only introspection,
drift detection against the live schema, migration SQL generation, and apply/rollback with
per-environment history (`apps/server/src/modules/connections/`,
`packages/dbml-engine/src/{migrationDiff,migrationGenerator,rollbackGenerator}.ts`,
`ConnectionManagerModal`/`DeploymentModal`). Phases A–D shipped and were hardened once for
the SSRF/credential-encryption risks found in the first cut. **Each remaining gap needs its
own security review before being closed, not an audit afterwards** — this is the one
feature area where a mistake can destroy a client's data rather than just annoy them.

- [~] **Close the residual Phase A–D gaps** — **M**, not just untested:
  - DNS-rebinding protection (`hostGuard.ts` resolves-then-checks a hostname; a name that
    resolves safely and then points elsewhere at connect time still gets through).
  - A general private-IP-range block, if one is ever wanted — deliberately not the default
    today, since a self-hosted deployment's own DB is routinely on `localhost`/LAN.
  - Per-connection rate limiting.
  - An audit of what `sampleData`/risk-inspection queries can leak across a permission
    boundary.
  - A dedicated security review by someone who hasn't already been staring at this code.
  - MySQL: no way to roll back *through* a mid-batch failure — the generated rollback SQL
    reverses the complete diff, not whichever prefix actually executed before MySQL's
    per-statement auto-commit stopped it partway.
  - Multi-target promotion (dev → staging → prod) — a connection's `environment` is a
    display/history label today, not a pipeline the app understands.
- [ ] **Phase E — CI/CD automation** — **L**. "On merge to main, apply pending migrations to
  staging" via API/CLI/webhook. **Blocked by:** Phase 21's public API + scoped keys — not
  started, and Phases A–D's early arrival doesn't change that.

## Phase 28 — User-reported feedback (canvas popovers, DBML sync, relation UX)

Added 2026-08-19 from a direct user feedback session, not a code audit.

- [x] Table/column settings popovers now open beside the table (not over it) and close on
  canvas pan/zoom — done 2026-08-19.
- [x] Fixed a real bug: reordering a table's block in the DBML text got silently undone by
  the next resync, because `Y.Map` iteration order is fixed at first insert and never
  updates — `TABLE_ORDER_KEY` in `yjsBinding.ts` now tracks and restores the intended order
  — done 2026-08-19.
- [x] Ctrl+F in the DBML editor now focuses the search input — done 2026-08-19.
- [x] Relation UX: cardinality glyphs no longer sit in a circle, duplicate "1"/"n" labels on
  a shared column collapse to one, and relations can be reversed (settings popover +
  right-click menu) — done 2026-08-19.
- [x] **Canvas not always instant after a DBML edit** — the "second cause" this item was
  waiting on turned out to be two real ones, both found and fixed 2026-08-20 with an
  actual browser/bench harness instead of code review: the DBML-panel resync data-loss bug
  (Phase 6 above) and, at larger schemas, measured rendering bottlenecks (React Flow
  re-measuring the whole canvas per edit, an O(edges) store selector re-run per table on
  every store mutation, etc.) — worst-case blocking time cut 10-240x at 100-500 tables.
  Detail in `docs/perf/multiuser-concurrency-2026-08-20.md` and
  `docs/perf/canvas-perf-2026-08-20.md`.
- [ ] **Simplify waypoint create/move/delete on a relation line** — **M**. What: the
  existing machinery (`useEdgeRouting.ts`/`EdgeWaypoints.tsx`/`EdgeContextMenu.tsx`) is
  already fairly capable, but a plain click on the edge does either "select" or "insert a
  waypoint" depending on cursor proximity to the line, decided by a `candidatePoint` the
  user has no explicit indicator is armed beyond a small preview dot — the likely source of
  the "too complicated" complaint, though not confirmed. **How:** needs hands-on iteration
  against the real canvas (a browser connected) or the user's own steer on what specifically
  feels wrong before redesigning.
- [ ] **Auto-detect a relation pointing the "wrong" way** — **S-M**, needs a decision first.
  What: the schema has no notion of "correct" direction to check against — `Ref.from`/`to`
  are just two endpoints. **How:** a heuristic could flag a one-to-many ref whose "many"
  side's field is `pk`/`unique`, or whose "one" side's field is a bare non-key int (signals
  a swapped FK/PK) — but that heuristic needs the user's confirmation before building, since
  a false-positive warning on a legitimate schema is worse than no warning.

---

## Open decisions (revisit as needed)

- **Auth model** — resolved: full email/password auth with sessions, per-project/team
  permissions, invitations, admin console. No external IdP integration.
- **Canvas library** — React Flow, chosen for speed over a custom SVG/canvas engine;
  revisit if performance suffers on very large schemas (500+ tables).
- **History storage** — Yjs update log + periodic SQLite snapshots, avoids storing the
  full doc on every change.
- **SQLite as a SQL import/export dialect** — not supported by `@dbml/core` (only
  postgres/mysql/mssql/snowflake/schemarb). SQLite **export** ships as the example plugin
  (generated straight from the `Project`, no parser needed); SQLite **import** would still
  need a dedicated DDL parser — not planned unless someone asks.
- **Plugin trust model** — sandboxed Worker + per-browser install, no server-side plugin
  store. Revisit if plugins need to be shared across a team (see Phase 17).
- **Desktop-only or responsive?** — undecided (Phase 22). Schema modelling on a phone is a
  thin use case; declaring desktop-only costs a sentence, half-supporting touch costs an
  **XL** and still disappoints.
- **Is "local-first" the architecture or the marketing?** — today it's the marketing (all
  state is server-side, corrected in the copy already). Committing to real offline
  persistence (IndexedDB + deferred sync) would be a new architecture, not a copy fix.
- **Is there a hosted product?** — the landing page's pricing section marks the "Cloud
  géré" tier as not yet available, no price/CTA. If a hosted product ships, that pulls
  billing, tenancy and an SLA into scope — and separately, an MIT-licensed core permits
  anyone else to host it commercially too, which may be fine but should be a decision on
  record rather than an oversight.
- **Does the public API come before or after the DB link?** — Phase 27's Phase E is
  blocked on Phase 21's API, but Phases A–D are not. The API unblocks more (webhooks, CI,
  integrations); the DB link differentiates more. Sequencing them explicitly beats
  discovering the dependency mid-build.
- **i18n** — resolved 2026-08-09: all-French, no i18n library. Revisit only if a second
  target language becomes a real goal — the strings are inline today, so adopting
  i18next/react-intl later means touching every component that renders text.
