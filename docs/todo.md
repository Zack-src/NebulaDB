# AthanorDB — TODO

DBML-native, self-hosted, multi-user, versioned, visual editor.

Legend: `[ ]` todo, `[~]` in progress/partially done, `[x]` done. Every open item follows
the same shape — **What** it means, concretely, **How** to build it (files, approach), and
**Blocked by** when something else has to land first. Effort tags: **S** (hours), **M** (a
day or two), **L** (about a week), **XL** (a project of its own).

**Rewritten 2026-09-23**, after the React → Svelte 5 migration (`73823b5`, completed
2026-09-22 — see `docs/svelte-migration.md`). The previous version of this file predated
that migration and pointed at files/APIs that no longer exist (`.tsx` paths, React Flow,
`useSyncExternalStore`, `React.memo`). This pass re-verified every item against the current
codebase rather than trusting the prior text: ran the full build, the full test suite (349
tests), `npm run test:e2e` (4/4, real browser + real server), `check:circular`, and `grep`/
`find` checks for every concrete claim (file existence, symbol existence, absence of things
claimed absent). Corrections made:
- **Closed** Phase 16's route-level test coverage item — `routes.test.ts` now exists for
  `invitations`, `teams`, `users`, `connections`, `apiKeys`, `convert`, `publicApi`, plus
  `totpRoutes.test.ts`; it wasn't done at the last writing, it is now.
- **Updated** every file reference from `.tsx` to its current `.svelte` path
  (`ComponentCatalogue.svelte`, `CanvasArea.svelte`, `ProjectEditor.svelte`,
  `PluginManagerDialog.svelte`, `DeploymentModal.svelte`, `ConnectionManagerModal.svelte`).
- **Refreshed** the file-size watchlist — post-migration line counts differ from the old
  ones (some grew, e.g. `CanvasArea.svelte` 463 l., `DeploymentModal.svelte` 501 l.).
- **Added** two items straight from this pass: two unconfirmed perf regressions the
  migration's own bench report flagged (Phase 23), and a small lint cleanup (Phase 23).
- Everything else below was independently re-checked, not just copied forward: DNS-rebinding
  gap still open (`hostGuard.ts` still says so in its own comment), no SMTP/nodemailer
  anywhere in `apps/server`, no OpenAPI/webhook/project-template code exists yet, no git
  tags exist yet, field-level CRDT is still one `Y.Map` entry per whole table (not per
  field), plugin storage is still browser-only (no server-side plugin table/route).

Phases 0–5, 7–9, 12, 14, 18, 26 are fully closed and pruned (none pointed at by number from
outside this file — see `git log --follow -p -- docs/todo.md` to recover the detail on any
of them).

---

## Phase 6 — Multi-user editing

- [x] **DBML-panel resync data-loss bug** — fixed 2026-08-20, verified with two real browser
  sessions on one project. `documentSync` transaction annotation + three-way merge
  (`preserveConcurrentAdditions`, `packages/dbml-engine/src/concurrentEdits.ts`). Re-verified
  2026-09-23: `concurrentEdits.test.ts` present and passing, still exercised by the full
  suite.
- [~] **Field-level CRDT merge within one table** — **S-M**, low priority. **What:** two
  users editing different fields of the *same* table at the same time still last-write-wins
  instead of merging per field. **Confirmed still true 2026-09-23**: `getTablesMap` in
  `packages/shared/src/yjsBinding.ts` stores each table as one opaque object under one
  `Y.Map` key — no per-field sub-map. **How:** split each table's fields into individual Yjs
  sub-entries — touches `yjsBinding.ts`, `Room`'s watched-collection logic in
  `apps/server/src/realtime/room.ts`, and every web mutation that currently does
  `tablesMap.set(id, {...current, ...patch})`. Revisit only if this specific collision is
  reported in practice.
- [x] **Committed multi-user regression test** — `importExport.concurrency.test.ts` present
  and passing (verified 2026-09-23), hits the real `POST /api/projects/:id/import` route
  against a real `Room`'s live doc.

## Phase 10 — Packaging & deployment

- [x] **Docker build verified on a real daemon** — `Dockerfile` still pins
  `node:22-bookworm-slim` (checked 2026-09-23, matches `better-sqlite3@13`'s Node ≥22
  requirement). Container starts healthy, graceful shutdown confirmed via real `SIGTERM`.

## Phase 11 — Testing & docs

- [x] Unit tests for `dbml-engine`/`shared`.
- [x] Server integration tests (REST + WS) — `Room`/WS covered by `yjs/room.test.ts`,
  every route module has its own `routes.test.ts` (re-confirmed 2026-09-23, see list above).
- [x] **Browser-based E2E coverage** (canvas, DBML sync, components, plugin sandbox,
  project lifecycle) — `apps/web/e2e/{canvas-interactions,component-catalogue,
  plugin-sandbox,project-lifecycle}.e2e.ts`, shared boot/teardown in `e2e/harness.ts`.
  **Re-run in full 2026-09-23 post-migration: 4/4 pass** against the real Svelte build —
  canvas select/delete/undo/multi-select, component catalogue in both themes with zero
  console errors, the plugin sandbox actually spinning up a real Worker, full project
  create → edit → reload → persist round-trip. No `.tsx` reference remains; the test files
  themselves were already framework-agnostic (they drive the DOM, not React internals).
- [x] User docs (`docs/user-guide.md`), contributing guide, `SECURITY.md`, `CHANGELOG.md`.

## Phase 13 — Security hardening

- [x] Rate limiting, scrypt cost, max password length, session cleanup, secure-cookie
  guard, CSRF origin check, invitation-accept TOCTOU race, entity-count limits, email
  validation.
- [x] **Invitation delivery** — done 2026-09-23 with Phase 20's transactional email: with
  SMTP configured, `POST /api/invitations` emails the link (`emailSent` in the response,
  shown in the admin tab); without it, or if the send fails, the copy-the-link flow is
  unchanged.

## Phase 16 — Testing, docs & dev experience

- [x] Lint clean and CI-enforced, CI pipeline, README auth docs, LICENSE.
- [x] **Route-level test coverage for auth/teams/invitations** — **closed 2026-09-23**,
  was `[~]` before. `routes.test.ts` now exists for every route module (`invitations`,
  `teams`, `users`, `connections`, `apiKeys`, `convert`, `publicApi`) plus
  `totpRoutes.test.ts`; `app.test.ts` still covers the cross-cutting auth/CSRF/rate-limit
  surface. Nothing left uncovered at the route layer.
- [x] **`apps/web` test coverage** — pure-logic modules covered by unit tests,
  canvas/components/plugin-sandbox covered by Playwright E2E (Phase 11).
- [x] `@dbml/core` upgraded to 10.1.0, Vite on 8 (rolldown-vite). `npm audit` was **not**
  clean on 2026-09-23 (fastify ≤5.12.0, sharp <0.35.4, fast-uri — all pre-existing, all
  fixable in-range); `npm audit fix` → fastify 5.12.5, sharp 0.35.4, 0 vulnerabilities, full
  build/tests/E2E re-run green.

## Phase 17 — Plugin system

- [x] Plugin runtime (sandboxed Worker), built-ins, example plugin, plugin manager UI
  (`apps/web/src/features/plugins/PluginManagerDialog.svelte`), Figma-style toolbar,
  settings/persisted state, canvas-command selection context, plugin-defined shortcuts,
  source download.
- [ ] **Plugin-provided UI** — **L**, speculative. What: a plugin renders its own HTML in a
  sandboxed iframe panel (talking over `postMessage`), instead of only a declarative
  settings form. **Confirmed still not built 2026-09-23** — `PluginHost.ts`/
  `sandboxRuntime.ts` use `postMessage` only to run the sandboxed exporter/importer
  functions, not to host arbitrary plugin-rendered UI. Not worth building until a real
  plugin needs more than a settings form.
- [ ] **Server-installed / team-shared plugins** — **M**, deliberately deferred. Plugins
  still live in one browser's `localStorage` (confirmed 2026-09-23 — no plugin table/route
  in `apps/server/src`). Would mean the server storing third-party code — a real trust-model
  change. Revisit if a team actually asks for this.
- [ ] **Plugin publishing/discovery** — **M**. Blocked by the item above — no manifest URL,
  registry, or update check exists; sharing a plugin today means sending a `.js` file.

## Phase 19 — Security hardening for professional use

- [x] Session revocation, account disable/delete, `canWrite` live re-evaluation, audit log,
  per-account project cap, account lockout, `npm audit` CI gate, documented secret
  management, TOTP 2FA.
- [x] **Self-service password reset** — done 2026-09-23. `modules/auth/passwordReset.ts`
  + `passwordResetRoutes.ts`: SHA-256-only token storage (migration 16), 1h TTL, single use
  via a conditional UPDATE, older links invalidated by a newer one, 60s per-account
  cooldown + per-IP rate limit, identical answer for unknown addresses with the SMTP send
  deferred past the response, links built from `ATHANORDB_PUBLIC_URL` (never `Host`). Use
  kills every session + live socket and clears the login lockout; TOTP still required
  after. Offered only when email is configured (`GET /api/auth/features`). Tests: route
  suite against a real in-process SMTP server, plus `password-reset.e2e.ts`.
- [ ] **Passkeys / WebAuthn** — **L**. Confirmed no `webauthn`/`passkey` code exists yet.
  TOTP already covers the shorter 2FA effort; not urgent.

## Phase 20 — Accounts & onboarding

- [x] Configurable session length.
- [x] **Transactional email** — done 2026-09-23. `infrastructure/mailer.ts` (nodemailer),
  `ATHANORDB_SMTP_{HOST,PORT,SECURE,USER,PASSWORD,FROM}` + `ATHANORDB_PUBLIC_URL` validated
  at boot in `config.ts` (email is entirely optional — unset host = off), French
  text+HTML templates in `shared/emailTemplates.ts`. Verified over real SMTP (an
  in-process `smtp-server` on TCP with auth) in both the route tests and the E2E suite.
  **Not verified:** delivery through a real third-party relay (TLS on 465/STARTTLS on 587,
  SPF/DKIM) — worth one manual send on a real instance before relying on it.
- [ ] **Notifications** — **M**. Nothing tells a user they were added to a project/team, or
  that someone replied to their comment thread (`CommentThread.svelte` still has no
  `@mention` support — confirmed 2026-09-23). **Unblocked 2026-09-23** — `sendMail` and
  the template helpers in `shared/emailTemplates.ts` exist now; what's left is deciding
  which events notify, and a per-user opt-out (an email a user can't turn off becomes spam).
- [ ] **Per-project/team roles beyond view/edit/administrator** — **M**, only if actually
  wanted. Revisit on real demand.

## Phase 21 — Product features & integrations

- [x] **Public API** (`/api/v1`) — full CRUD+IAM+ops surface, API keys, route-level rate
  limits, deploy/rollback triggers, SVG/PNG export. Documented in `docs/public-api.md`
  (still present, checked 2026-09-23). **Not done**: OpenAPI schema, per-key usage quotas,
  multi-project key scoping.
- [x] **OpenAPI schema** — done 2026-09-23. `GET /api/v1/openapi.json` (public, 3.1),
  built from a compact operation catalogue in `modules/publicApi/openapi.ts` rather than
  Fastify route schemas (adding validation schemas to every route would change request
  handling, not just docs). Error `code` enum comes straight from `ERROR_CATALOG`; scope
  per operation as `x-athanordb-scope`. Drift is caught by `openapi.test.ts`: registered
  routes ↔ catalogue ↔ `docs/public-api.md` tables (mutation-checked), and the document
  is validated with `@readme/openapi-parser`. Not done: request validation from the same
  schemas.
- [x] **Webhooks** — done 2026-09-23 (`modules/webhooks/`, doc: `docs/webhooks.md`).
  Per project, admin-only, ≤10. Events `schema.changed` (coalesced after 30 s quiet,
  structural changes only — baseline seeded from the snapshot so a drag after a restart
  isn't news), `deployment.completed` (deploy + rollback), `ping`. Formats: signed JSON
  (`t=…,v1=HMAC-SHA256("t.body")`), Slack, Discord. Deliveries are rows first
  (persistent retry queue: 1m/5m/30m/2h/6h), auto-disable after 20 abandoned in a row,
  30-day log. SSRF: `node:http` (no redirects), address checked *at connect time* via a
  `lookup` hook + literal-IP check — no DNS-rebinding gap for webhooks (unlike DB
  connections, see Phase 27). Response bodies never read. Editing hot path costs one
  Map lookup for projects without webhooks. Found+fixed while testing: the queue's
  "already running" flag could pin itself on a settled promise and stop all deliveries
  after the first empty tick. Tests: route suite against a real local receiver +
  `webhooks.e2e.ts`. **Not done:** secret rotation (delete + recreate), webhooks via
  `/api/v1`, per-user notification opt-in (Phase 20 notifications is a separate item).
- [x] **Project templates** — done 2026-09-23. Four starters (blog, e-commerce,
  multi-tenant SaaS, auth) in `packages/dbml-engine/src/templates.ts`, seeded server-side
  through the same `toProject` → `mergeProjectIntoExisting` path as an import
  (`projectFromTemplate`); `POST /api/projects` and `/api/v1/projects` take an optional
  `template`. Gallery: `TemplatePickerModal.svelte`. Covered by engine tests (parse,
  validate, unique ids, layout kept), a route test, and `project-templates.e2e.ts`.
- [x] **Cross-project diff** — done 2026-09-23. Not `diff.ts` after all: it matches by
  *id*, and ids never line up across projects (every table would read "removed + added").
  Uses the name-matched `diffTargetAgainstLive` instead, which also feeds
  `generateMigrationSql` — so the editor's _Comparer_ modal
  (`features/editor/compare/CompareProjectsModal.svelte`) shows the differences *and* the
  SQL turning one schema into the other, per dialect, with a swap-direction toggle. Other
  project read via `GET /api/projects/:id/content` (view permission, audited as an export,
  never starts a room). Tests: route test + `compare-projects.e2e.ts`. **Caveat:** its SQL
  inherits the ref-direction bug in Phase 28 below.
- [x] **Global multi-project search** — done 2026-09-23. `GET /api/search?q=` over table,
  column and enum names (+ table notes) across every non-trashed project the caller can
  view; ranked exact → prefix → substring, capped at 100. Idle projects are read from their
  snapshot with a per-project name index cached on the snapshot's `updated_at`; live rooms
  read directly (`realtime/readOnlyProject.ts`, never `getRoom`). Dashboard search box now
  also shows an "inside your schemas" section; a hit opens the project centred on the
  table with the column highlighted. While wiring that, fixed a latent canvas bug: any
  programmatic jump right after mount (the DBML panel's double-click too) was undone by
  Svelte Flow's initial `fitView` and by the refit-on-resize — `goToTable` now waits for
  `nodesInitialized && !fitViewQueued` and counts as a user viewport move. Tests: route
  tests (permissions, trash, ranking, live vs snapshot) + `global-search.e2e.ts`.
- [ ] **Comment mentions/notifications** — **M**. `CommentThread.svelte`/
  `CommentThreadPanel.svelte` support threads but not `@user`. Email delivery exists now;
  still depends on the Phase 20 notifications item (which events, opt-out).
- [ ] **Export to other ecosystems** (Prisma schema, TypeORM entities, GraphQL SDL, JSON
  Schema) — **M each, as plugins**, deliberately not core. The plugin API already covers
  exactly this shape (the SQLite exporter ships as the example plugin).

## Phase 22 — UX, theming & accessibility

- [x] Light theme, error boundary (now `<svelte:boundary>`, ported from the old React
  `ErrorBoundary` class — see `docs/svelte-migration.md` §2), loading-state placeholders.
- [ ] **Landing page and app are visually out of step** — **M**. Not re-checked visually
  this pass (code-level verification only); revisit with a browser pass since the whole
  frontend rendering stack changed under this item since it was last written.
- [ ] **Mobile/tablet: decide, don't drift** — **S** to document, **XL** to actually build.
  Svelte Flow (like React Flow before it) assumes a wide pointer-driven screen. Still
  undecided.
- [ ] **Accessibility audit** — **M-L**. No systematic check of contrast, keyboard
  navigation or screen-reader behaviour has been run against the Svelte UI yet — the old
  React-era audit (never done either, per the prior version of this file) doesn't carry
  over automatically even though most components ported close to 1:1.

## Phase 23 — Code health & tooling

- [x] Bundle-size code-splitting, i18n unified to French, Prettier CI gate,
  circular-dependency lint, complexity lint, a "reach for this before writing that" table in
  `CONTRIBUTING.md`.
- [x] **Component catalogue** — `apps/web/src/components/dev/ComponentCatalogue.svelte`,
  routed at `/#components`. Re-verified 2026-09-23 via the E2E suite: every primitive
  renders in both themes with zero console errors.
- [x] Web test coverage beyond pure logic — closed with Phase 11's browser-test-tooling
  item.
- [x] `realtime/room.ts` split (`roomRegistry.ts`, `room/limits.ts`) — server-side, untouched
  by the Svelte migration, still 402 lines.
- [~] **File-size watchlist — refreshed 2026-09-23** (post-migration line counts differ from
  before; nothing here is broken, just worth splitting opportunistically, same as before):
  - `packages/dbml-engine/src/dbml.ts` — 504 l. (server-side, grown from 442)
  - `apps/web/src/features/plugins/communityTemplates.ts` — 722 l. (data-heavy, may not be
    worth splitting — it's mostly template content, not logic)
  - `apps/web/src/features/editor/dbml/symbols.ts` — 566 l.
  - `apps/web/src/features/connections/DeploymentModal.svelte` — 501 l.
  - `apps/web/src/features/editor/canvas/autoLayout.ts` — 465 l.
  - `apps/web/src/features/editor/canvas/CanvasArea.svelte` — 463 l.
  - `apps/web/src/features/editor/ProjectEditor.svelte` — 459 l.
  - `apps/web/src/features/connections/ConnectionManagerModal.svelte` — 449 l.
  - None of the above are structural bugs — split opportunistically, same policy as before.
- [x] **Lint cleanup** — done 2026-09-23, `npm run lint` is clean again.
  `generateFieldAlterations` split into one helper per change kind (engine tests
  unchanged and green); `perfMonitor.ts` got back the past-threshold `console.warn` its
  `quiet` flag and doc comment describe (the flag had nothing left to silence); unused
  `reply` param dropped.
- [x] **DBML default expressions lost their backticks on round-trip** — fixed 2026-09-23.
  `Field.defaultKind` (`expression`/`string`/`number`/`boolean`, straight from @dbml/core's
  `dbdefault.type`) rides alongside the unchanged `Field.default` string, so no consumer
  of `default` (drivers, plugins) had to change. Serializer writes `` `now()` `` vs
  `'now()'` by kind; one `sqlDefaultLiteral` decides SQL literals for CREATE, ALTER SET
  DEFAULT (which used to quote `now()` as a string) and rollback. No kind (older data,
  field-editor input) → the previous guess, and the serializer's guess now matches the SQL
  generator's, so legacy `now()` gets written back as an expression and fixed on the next
  parse. Field editor shows/accepts backticks for expressions. Diffs only flag a kind
  change when both sides have one. Tests: `defaults.test.ts`; verified in the real DBML
  panel on a template project.
- [ ] **Confirm two perf regressions the migration's own bench flagged** — **S**, from
  `docs/perf/svelte-migration-results.md` (single pass, explicitly marked "to confirm with a
  second pass" in that doc): `zoom-links-on` at "complet" detail level went from 0→29ms
  blocking at 100 tables and 4→40ms at 500 tables; `delete-columns` at 500 tables regressed
  ~6ms. Both are small in absolute terms and the same doc shows the *overall* migration is a
  large net win (−58% blocking time, −36% mount time), but neither regression has had a
  second measurement pass to confirm it's real and not noise.

## Phase 24 — Observability & operations

- [x] `/api/health`, scheduled backups with retention, Docker Compose single-instance setup.
- [x] Logging (request-id correlation where a request exists, rotation guidance).
- [x] **Metrics endpoint** — `GET /api/metrics`, re-confirmed present 2026-09-23
  (`infrastructure/metrics.ts`, `totalConnectionCount()` wired in).
- [x] **Error tracking** — `error_log` table, `POST /api/errors/client`, admin UI tab.

## Phase 25 — Documentation, compliance & release process

- [x] GDPR export/deletion/retention, self-hosted Google Fonts, `SECURITY.md`, reverse-proxy
  deployment guidance.
- [~] **Versioning scheme / git tags** — decided (SemVer, `0.y.z` until the V1 checklist
  clears), documented in `CHANGELOG.md`. **Follow-through still not done**: confirmed
  2026-09-23, `git tag -l` returns nothing, every workspace is still `0.0.1`. Cutting the
  first tagged release is a deliberate release action, not something to do unilaterally.

## Phase 27 — Live database link & deployment

Connects a project to a real database: read-only introspection, drift detection, migration
SQL generation, apply/rollback with per-environment history
(`apps/server/src/modules/connections/`,
`packages/dbml-engine/src/{migrationDiff,migrationGenerator,rollbackGenerator}.ts`,
`ConnectionManagerModal.svelte`/`DeploymentModal.svelte`). **This is the one feature area
where a mistake can destroy a client's data — each remaining gap needs its own security
review before being closed, not an audit afterwards.**

- [~] **Close the residual Phase A–D gaps** — **M**, all reconfirmed still open 2026-09-23:
  - DNS-rebinding protection — `hostGuard.ts`'s own header comment still states this gap
    explicitly (resolve-then-check is TOCTOU-vulnerable to a hostname that re-resolves
    elsewhere at connect time).
  - A general private-IP-range block, if one is ever wanted — deliberately not the default,
    since a self-hosted deployment's own DB is routinely on `localhost`/LAN.
  - ~~Per-connection rate limiting~~ — **done 2026-09-23**: `connections/connectionBudget.ts`,
    enforced in `createDatabaseDriver` so every path (UI, `/api/v1`, test/pull/plan/deploy/
    rollback) is covered. Keyed by the *target database* (engine+host+port+db or SQLite
    file, SHA-256 so no connection string is kept), not the connection id — the ad-hoc
    test route and several connections to one server share a budget. 30 driver opens/min,
    plus 5 `executeMigration`/min; 429 `CONNECTION_RATE_LIMITED`, never recorded as a
    failed deployment. In-memory per process (single-instance topology).
  - ~~Deleted projects kept their connections~~ — **fixed 2026-09-23**: found while adding
    webhooks. `PRAGMA foreign_keys` is off, so the schema's `ON DELETE CASCADE` never
    fired: a deleted project's `project_connections` (encrypted credentials), deployment
    history and project-restricted API keys outlived it. `deleteProjectCascade` now
    deletes them explicitly, in one transaction. Rows orphaned *before* this fix are
    still there — a one-off cleanup (`DELETE … WHERE project_id NOT IN (SELECT id FROM
    projects)`) is worth running on existing instances.
  - An audit of what `sampleData`/risk-inspection queries can leak across a permission
    boundary.
  - A dedicated security review by someone who hasn't already been staring at this code.
  - MySQL: no way to roll back *through* a mid-batch failure.
  - Multi-target promotion (dev → staging → prod) — a connection's `environment` is still a
    display/history label, not a pipeline the app understands.
- [ ] **Phase E — CI/CD automation** — **L**. Not blocked (Phase 21's `/api/v1`
  deploy-trigger endpoint is the primitive) but the CI-side wiring (GitHub Action, CLI
  wrapper, docs) isn't built.
- [ ] **Phase F — Database users & permissions management** — **XL**, needs scoping
  first. **What:** manage the *connected database's own* accounts from the app, not
  AthanorDB's users: list the roles/users that exist on the target DB and what they're
  granted (per schema/table, ideally per column), create/drop a role, and grant/revoke
  privileges (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/…) through the same review-then-apply
  flow a schema migration gets, so the diff and the generated `GRANT`/`REVOKE` SQL are
  visible before anything runs. Confirmed 2026-09-23: nothing like this exists. The
  `DatabaseDriver` interface (`drivers/interface.ts`) only has `testConnection`/
  `introspectSchema`/`inspectRisks`/`executeMigration`/`close`, and no driver reads
  `pg_roles`/`mysql.user`/`sys.database_principals`/`DBA_USERS`. **How:**
  - Read side first, since it's lower risk and useful on its own: an
    `introspectPrivileges()` per driver, returning one normalised shape (role, object,
    privilege, grantable), shown in a new "Accès" tab of `ConnectionManagerModal.svelte`
    (already 449 l., on the watchlist, so the tab should be a separate component).
  - Write side: a privilege diff + `GRANT`/`REVOKE`/`CREATE ROLE` generator next to
    `migrationGenerator.ts`, with a rollback counterpart like `rollbackGenerator.ts`, and
    entries in the per-environment deployment history.
  - Optional: declare the intended grants in the project itself (DBML has no syntax for
    them, so a sidecar next to the visual metadata), so drift detection covers
    permissions as well as structure.
  - Dialect gaps to design around: SQLite has no users at all (hide the feature there);
    MySQL privileges are per `user@host`; Oracle and SQL Server split logins/users/
    schemas differently from Postgres roles.
  **Security, above the Phase 27 bar:** creating an account needs a password, which the
  app must never store or log (show a generated one once, or require the operator to
  provide it). The stored connection's credentials need `CREATEROLE`/`GRANT OPTION`,
  far more than introspection needs, so this should be opt-in per connection, gated
  behind the project `administrator` level (not `edit`), recorded in the audit log, and
  never able to touch the connection's own account (no locking yourself out). A separate
  security review is required before the write side ships, same as the other Phase 27
  gaps. **Blocked by:** nothing technically. Worth deciding with the Phase A–D residual
  gaps (per-connection rate limiting, the `sampleData` permission-boundary audit)
  before widening what a connection can do.

## Phase 28 — User-reported feedback (canvas popovers, DBML sync, relation UX)

- [x] **Ref direction — FKs landed on the wrong table** — fixed 2026-09-23 (was 🔴). One
  rule now, everywhere: **`from` = the column carrying the foreign key, `to` = the column
  it references** (`packages/shared/src/refOrientation.ts`) — the rule the DB drivers, both
  SQL generators and the Prisma/SQLite plugins already followed. Fixed:
  - `toProject` orients @dbml/core's endpoints with @dbml/core's own exporter rule
    (referenced = first endpoint with relation `1`). Every DBML spelling now parses the
    same way: inline `[ref: > …]` on the FK column, `[ref: < …]` on the referenced column,
    `Ref: a > b`, `Ref: b < a`, long form, and one-to-one `-` (`refDirection.test.ts`,
    incl. SQL export, migration SQL and double round-trip for each).
  - Serializer: one-to-one written referenced-side first (@dbml/core puts a `-` FK on the
    second endpoint), so it round-trips.
  - Display: canvas and SVG-export "1/n" endpoint labels, and both Mermaid generators
    (built-in + community template), assumed the opposite convention — flipped.
  - Canvas drag: a ref drawn key → plain column is stored the right way round.
  - `refSignature` is direction-free now (legacy `a->b` sidecar keys still read), so a
    flip never orphans a ref's style/waypoints or its match on reimport.
  - **Stored data:** `Room` repairs certainly-inverted refs on load (`isRefInverted`:
    one-to-many from a key to a non-key; one-to-one from a PK to a unique non-PK),
    persisted as a revision authored "AthanorDB (sens des relations corrigé)", idempotent.
    Ambiguous shapes (key↔key) are left alone. Test in `room.test.ts`.
  - Verified in a real browser: blog template's SQL export now has all 5 FKs on the owning
    table (was all 5 inverted); arrows point FK → referenced key.
  **Still owed (Phase 27 rule):** deployment SQL changed as a consequence — worth a review
  by someone else before the next real deployment, even though every path is now tested.
- [x] Table/column settings popovers open beside the table, close on pan/zoom.
- [x] Table-block reorder in DBML text no longer silently undone by resync
  (`TABLE_ORDER_KEY` in `yjsBinding.ts`).
- [x] Ctrl+F in the DBML editor focuses the search input.
- [x] Relation UX: cardinality glyphs, duplicate label collapse, relation reversal.
- [x] Canvas responsiveness after a DBML edit — both root causes (resync data loss, canvas
  rendering bottlenecks) fixed and measured.
- [ ] **Simplify waypoint create/move/delete on a relation line** — **M**. Confirmed still
  the same mechanism 2026-09-23: `EdgeWaypoints.svelte`/`edgeRouting.svelte.ts` still decide
  select-vs-insert-waypoint by cursor proximity to the line (`candidatePoint`), with only a
  small preview dot as feedback. Needs hands-on iteration against the real canvas or the
  user's own steer before redesigning.
- [ ] **Auto-detect a relation pointing the "wrong" way** — **S-M**, needs a decision first.
  Confirmed no such heuristic exists yet. A false-positive warning on a legitimate schema is
  worse than no warning — needs the user's confirmation before building.

---

## Open decisions (revisit as needed)

- **Auth model** — resolved: full email/password auth with sessions, per-project/team
  permissions, invitations, admin console. No external IdP integration.
- **Canvas library** — resolved 2026-09-22: migrated from React Flow to **Svelte Flow**
  (`@xyflow/svelte`, same underlying `@xyflow/system` engine as React Flow) as part of the
  full React → Svelte 5 rewrite. Net win on the measured bench (−58% blocking time, −36%
  mount time, −7% critical-path bundle) — see `docs/perf/svelte-migration-results.md`. The
  original "revisit if performance suffers on very large schemas" concern motivated part of
  this move, not just the framework switch itself.
- **History storage** — Yjs update log + periodic SQLite snapshots.
- **SQLite as a SQL import/export dialect** — not supported by `@dbml/core` for import.
  SQLite export ships as the example plugin. Import would need a dedicated DDL parser — not
  planned unless someone asks.
- **Plugin trust model** — sandboxed Worker + per-browser install, no server-side plugin
  store. Revisit if plugins need to be shared across a team (Phase 17).
- **Desktop-only or responsive?** — still undecided (Phase 22).
- **Is "local-first" the architecture or the marketing?** — still the marketing; all state
  is server-side. Committing to real offline persistence (IndexedDB + deferred sync) would
  be a new architecture, not a copy fix.
- **Is there a hosted product?** — the landing page's pricing section still marks "Cloud
  géré" as not yet available. If it ships, that pulls billing, tenancy and an SLA into
  scope.
- **Does the public API come before or after the DB link?** — Phase 27's Phase E is blocked
  on Phase 21's API; Phases A–D are not.
- **i18n** — resolved: all-French, no i18n library (now `i18n.svelte.ts`, a reactive module
  instead of a React context — same decision, ported mechanism). Revisit only if a second
  target language becomes a real goal.
