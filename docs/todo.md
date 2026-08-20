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

- [~] **Field-level CRDT merge within one table** — **S-M**, low priority. **What:** two
  users editing different fields of the *same* table at the same time currently
  last-write-wins instead of merging per field (edits to different tables already merge
  cleanly today). **How:** split each table's fields into individual Yjs sub-entries (e.g.
  one `Y.Map` per table instead of one opaque JSON blob) — touches
  `packages/shared/src/yjsBinding.ts`, `Room`'s watched-collection logic in
  `apps/server/src/realtime/room.ts`, and every web mutation that currently does
  `tablesMap.set(id, {...current, ...patch})`. Revisit only if real concurrent-edit
  conflicts get reported — nobody has hit this in practice yet.

## Phase 10 — Packaging & deployment

- [~] **Verify the Docker build on a real Docker daemon** — **S**. The Dockerfile/compose
  build fix (non-root user, healthcheck, `postinstall`-skip for native deps) has never been
  run through an actual `docker compose up --build` — it was fixed and reasoned through on
  a dev machine with no Docker daemon. **How:** run it on any machine with Docker, confirm
  the container boots, passes `/api/health`, and the named volume persists across a restart.

## Phase 11 — Testing & docs

- [x] Unit tests for `dbml-engine`/`shared` — done, `npm test`.
- [~] **Server integration tests (REST + WS)** — **S**, mostly done. `Room`/WS is fully
  covered (`yjs/room.test.ts`); `app.test.ts` covers the highest-risk REST surface (auth,
  CSRF, rate limiting, permission gating) via `buildApp()` + `.inject()`. **What's left:**
  the same `app.inject()` pattern extended to `routes/{teams,invitations,users,convert}.ts`
  and `routes/projects.ts` — mechanical now that the pattern and harness exist.
- [ ] **Browser-based test coverage (canvas, DBML sync, components, E2E)** — **L**. What:
  three related gaps that are really one missing piece of tooling — no E2E flow
  (create project → edit schema → reload → verify persistence) is committed as a real
  test (only ever run as throwaway Playwright scripts in a session); the canvas (React
  Flow nodes, drag/selection/Yjs-binding hooks) and every React component have zero test
  coverage; and Phase 17's plugin registry/sandbox-Worker path is untested for the same
  reason. How: pick a DOM story first — jsdom + a component-testing library, or Playwright
  against the built app — then land the one E2E flow as a committed regression test before
  spreading into component coverage. Decide this once, not three separate times.
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
- [~] **Verify graceful shutdown against a real SIGTERM** — **S**. The flush-before-exit
  path is verified directly (an edit made <2s before flush survives a reload), but signal
  *delivery* was never exercised — the dev machine is Windows, where Node doesn't receive a
  real SIGTERM. **How:** `docker stop` (or `kill -TERM`) a running instance on Linux and
  confirm every room's state flushed to SQLite before the process exits.

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
- [ ] **Upgrade `@dbml/core`** — **L**. 5 major versions behind (3.14.1 installed, 8.3.1
  latest). **Why it's not routine:** `dbml.ts`'s `toProject` reads a fair amount of raw,
  untyped structure straight off `@dbml/core`'s parse output (`schema?.tableGroups`,
  `table.id`, `idx.columns[].value`, etc.) — a 5-major jump can plausibly change any of
  those shapes, and a silent shape change would corrupt imports for every user rather than
  fail loudly. **How:** its own focused pass, gated on all 36 `dbml.test.ts`/
  `roundtrip.test.ts` cases (plus whatever's been added since) passing unchanged before and
  after.

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
  `/api/v1` surface, per-key rate limits. The "API key" field in
  `settings/SettingsTabContent.tsx` is a visual placeholder wired to nothing today.
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
- [ ] **Component catalogue** — **M**, low priority. `ui/` primitives have no isolated
  visual documentation (Storybook or equivalent). Worth it once more than one person works
  on the UI.
- [~] Web test coverage beyond pure logic — same gap as Phase 11's browser-test-tooling
  item, not repeated here.
- [ ] **Split `room.ts`** (498 lines: connection handling, persistence, awareness and sync
  in one file) — **M**. **How:** `realtime/room/Room.ts` (orchestration only) +
  `persistence.ts` + `awareness.ts` + `connection.ts`, with the already-free functions
  (`getRoom`/`closeAllRooms`/etc.) moving to `realtime/roomRegistry.ts`. Higher risk than
  most items here — it's the live WS/Yjs sync path with only `yjs/room.test.ts`'s 7 cases
  as a safety net; re-run those plus a manual two-tab concurrent-edit check after.
- [ ] **File-size watchlist** — **S** each, do opportunistically when next touching a file:
  `dbml/searchPanel.ts` (369 l.), `dbml.ts` (364 l.), `dbmlEditor/language.ts` (363 l., theme
  + language + hover mixed), `plugins/registry.ts` (350 l.), `ProjectEditor.tsx` (310 l.),
  `TableSettingsPopover.tsx` (309 l.). Not yet over the repo's 500-line norm, worth
  splitting before they get there.

## Phase 24 — Observability & operations

- [x] Real `/api/health` (DB check, room count, uptime, 503 on failure), scheduled backups
  with retention, single-instance Docker Compose documented — done 2026-08-09.
- [~] **Logging: request-id correlation + rotation guidance** — **S**. `ATHANORDB_LOG_LEVEL`
  and secret redaction are done; still open: the WS/`Room` code paths log through
  `console`, not the Fastify logger, so a request id doesn't correlate across them, and
  there's no written rotation/retention guidance for operators.
- [ ] **Metrics endpoint** — **M**. Nothing exposes connection counts, room counts,
  snapshot-write latency or error rates. For a service whose failure mode is "sync silently
  stopped", this is the difference between noticing and not.
- [ ] **Error tracking** — **S-M**. `uncaughtException` is caught, logged and survived, but
  nothing aggregates errors anywhere an operator would look. The client side has nothing at
  all.

## Phase 25 — Documentation, compliance & release process

- [x] GDPR export/deletion/retention, self-hosted Google Fonts, `SECURITY.md`, reverse-proxy
  deployment guidance — done 2026-08-09.
- [ ] **Versioning scheme / git tags** — **S**, decision + follow-through. `CHANGELOG.md`
  exists (Keep a Changelog format) but there's nothing to *point* an entry at yet — decide
  calendar versioning vs. staying 0.x until the V1 checklist clears, then start tagging.

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
- [~] **Canvas not always instant after a DBML edit** — **S**, needs a browser to finish.
  What: one real cause was found and fixed (the table-order bug above); WebSocket
  propagation itself was measured at 35ms end-to-end and the client-side render chain reads
  correctly on code review, so no second cause is confirmed. **How:** watch the actual
  canvas in a browser (Claude-in-Chrome wasn't connected when this was investigated) while
  reproducing the report to confirm whether a second bug exists.
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
