# AthanorDB — TODO

DBML-native, self-hosted, multi-user, versioned, visual editor — and, since the database
console, a workbench for the databases it models.

Legend: `[ ]` todo, `[~]` in progress/partially done, `[x]` done. Every open item follows the
same shape — **What** it means, concretely, **How** to build it (files, approach), and
**Blocked by** when something else has to land first. Effort tags: **S** (hours), **M** (a
day or two), **L** (about a week), **XL** (a project of its own).

**Reorganised 2026-10-02.** Phases 0–28 predate this pass and keep their numbers (code and
docs refer to them, e.g. "the Phase 27 rule"); finished work in them is condensed to one
line — `git log --follow -p -- docs/todo.md` recovers the detail. **Phases 29–38 are new**:
the schema ↔ database workbench roadmap, whose design (mock-ups, data model, open
questions) lives in [`docs/plan-schema-workbench.md`](plan-schema-workbench.md) — every
item below cites the section (`§n`) it comes from. The database console it builds on is
described in `docs/plan-db-admin.md`.

Before starting any phase, check the **Prerequisites** list just below.

---

## Roadmap at a glance

Suggested order (each lot depends only on lots above it — see the plan's §20 for the
dependency table). Lot numbers are the plan's. `✔` = done (2026-10-02: lot 1 and the copy / paste
item; lot 2 is next and starts with a decision — headless base or in-house, see Phase 29).

| Order | Lot | Phase | What                                                             |
| ----- | --- | ----- | ---------------------------------------------------------------- |
| ✔     | 1   | 29    | Fix the DBML editor "rollback" bug and the auto-format behaviour |
| 2     | 2   | 29    | UI foundations: tokens + custom form components                  |
| ✔     | —   | 29    | Canvas copy / paste of tables                                    |
| 4     | 3   | 30    | Table locks and roles                                            |
| 5     | 4   | 30    | "Structure goes through the schema" policy                       |
| 6     | 5   | 31    | Workspace shell with tabs                                        |
| 7     | 6   | 31    | SQL panel inside the schema editor                               |
| 8     | 18  | 31    | Undo / redo and visual history                                   |
| 9     | 14  | 32    | Configurable environment pipeline and promotion                  |
| 10    | 11  | 32    | Logical backups, restore, deployment rollback                    |
| 11    | 15  | 32    | Destructive-change detection                                     |
| 12    | 7   | 33    | CSV seeds                                                        |
| 13    | 16  | 33    | Test-data generation (+ AI extension point)                      |
| 14    | 8   | 34    | Admin activity journal                                           |
| 15    | 9   | 34    | External-change detection and alerts                             |
| 16    | 19  | 34    | Health dashboard, traffic, visual EXPLAIN                        |
| 17    | 20  | 34    | Subscription notifications                                       |
| 18    | 10  | 34    | Database-side logs (levels 1–2)                                  |
| 19    | 12  | 35    | Derived projects (base + variants)                               |
| 20    | 13  | 32    | Native backups, fine data rollback, unified timeline             |
| 21    | 17  | 36    | Schema linter + data dictionary                                  |
| 22    | 21  | 36    | Index suggestions and clean-up                                   |
| 23    | 22  | 36    | Query advisor (opt-in)                                           |
| 24    | 23  | 37    | Visual overhaul, screen by screen (runs alongside everything)    |

### Prerequisites to settle before coding (cross-cutting)

- [ ] **Role / permission matrix** — **S** to document. Roles are spread across
      `modules/projects/`, `modules/teams/` and `shared/guards.ts` (`requireAdmin`); there is no
      single table of "who can do what". Locks (Phase 30), SQL for non-admins (Phase 31),
      approvals (Phase 32) and per-variant rights (Phase 35) all need it. Write it first, in
      `docs/` (one page: role × action).
- [ ] **Stable ids for schema objects** — **S** to verify. Variants (Phase 35), destructive
      rename detection (Phase 32) and per-column locks need a table/column to keep its identity
      across a rename. Check `packages/shared/src/schema.ts` (`Table`/`Field` ids) and whether the
      DBML round-trip preserves them (`packages/dbml-engine/src/dbml.ts`).
- [ ] **Schema fingerprint** — **M**. One normalised, hashable representation of an
      introspected schema (canonical types, stable ordering, equivalent defaults) reused by drift
      detection (Phase 34), rollback script generation (Phase 32) and environment comparison
      (Phase 32). Build once, in `packages/dbml-engine/`, on top of `introspectSchema` /
      `diffTargetAgainstLive`. **Blocks** three phases — do not let each invent its own.
- [ ] **Background job runner** — **M**. Health checks run on one timer
      (`ATHANORDB_CONNECTION_HEALTH_INTERVAL_MINUTES`); backups, drift checks, metrics sampling
      and notifications digests all need scheduled, cancellable, budget-aware jobs with progress.
      Generalise that timer into `infrastructure/jobs.ts` (single-instance topology, in-process,
      persisted state in a table) before adding the second scheduled feature.
- [ ] **Capability levels per connection** — **S**. Level 0 (catalogue read), 1 (supervision
      views), 2 (server-side audit configured) — detected at connection test and stored on
      `db_connections` (`plan §8.3`). Journal, traffic, advisor and drift attribution all branch on it.
- [ ] **Migrations** — next migration number is **20**. Every item below that adds a table
      gets its own migration, tested on a populated database (`infrastructure/migrations.test.ts`).
      Reminder from `memory`: saving `migrations.ts` while `npm run dev` runs migrates the real dev
      DB, one way — work on a copy.

---

## V1 checklist (carried over from the retired `docs/v1-roadmap.md`)

The 2026-08-09 product audit (`v1-roadmap.md`) is gone: nearly every item in it shipped, and
what was left is below. **`0.y.z` stays until this list is clear, then `1.0.0` is tagged**
(`CHANGELOG.md` points here). The audit's conclusion still holds: no **L** item is required for
a credible V1; what costs most (DB link, public API, SSO) was V2 material — and the DB link and
API have since shipped.

- [ ] **First tagged release** — **S**, a deliberate release action (see Phase 25): every
      workspace is still `0.0.1`, `git tag -l` is empty.
- [ ] **Legal review of the templates** — not code. `docs/legal/{cgu,confidentialite}.md` are
      templates written from the code's verified behaviour; the operator fills the `[…]` markers and
      has a lawyer read them. Remember: the instance operator, not this project, is publisher and
      data controller.
- [ ] **Decide the licence** — **S**, but decide **early**: MIT lets anyone host and resell the
      product, including against the announced hosted offer. Switching to AGPL touches two files
      while there are no outside contributors; much heavier afterwards. Tied to "Is there a hosted
      product?" in the open decisions.
- [ ] **First-run onboarding** — **M**. Nothing guides a new user to the canvas, shortcuts
      (`Ctrl+F`, `Ctrl+D`, and the new copy/paste) or plugins: a short guided tour / tooltips.
      Best done once the Phase 29 components and Phase 31 workspace shell exist.
- [ ] **Written decisions** (cost one sentence if assumed): mobile / tablet (Phase 22), and
      the language policy (fr + en, see open decisions).
- [ ] **Out of V1, stated plainly rather than implied:** SSO, passkeys (TOTP 2FA is done), real
      offline mode, plugin marketplace. The user guide ends with the list of what the product does
      not do yet — keep it in sync with this file (`docs/user-guide.md`).

---

## Phase 29 — Editor reliability and UI foundations (plan §1, §2)

- [x] **DBML editor: edits get "rolled back" while typing** — fixed 2026-10-02. Reproduced
      first, then three causes found and closed (`features/editor/dbml/bufferSync.ts`):
  1. **Baseline advanced on send, not on success.** A pause on a half-typed table name
     (`> cust.id`) posted an invalid buffer; it then became the _baseline_ of the next import,
     the server could not parse it, treated everything as "added by someone else" and
     **restored the old `Ref`** next to the new one. The baseline now only moves when an import
     is acknowledged, and imports are sent one at a time.
  2. **`dbmlSignature` was not canonical for relations.** `a.x < b.y` and inline `[ref: > …]`
     never matched the serializer's `Ref: b.y > a.x`, so every sync replaced the **whole
     buffer** (comments and layout lost). One relation now has one signature (`symbols.ts`).
  3. **Races.** An import answering for an older revision marked a newer buffer clean, and the
     HTTP answer could beat the realtime update (the pre-import project was mirrored back).
     Revision counter + a short grace period; no resync within 1.5 s of a keystroke.
     Also: the resync dispatch maps the cursor through the change and stays out of the undo
     history. **Verified:** `bufferSync.test.ts` (real parse/merge pipeline, two clients),
     `symbols.test.ts`, and `e2e/dbml-editing.e2e.ts` in a real browser — the e2e **fails on the
     previous code** and passes now. **Not done:** when a collaborator's change really differs,
     the buffer is still replaced by the canonical serialisation as a whole (comments lost) — a
     per-block merge would keep untouched tables as written. **Found on the way:** `npm test` in
     `apps/web` ran 5 of 66 tests (unquoted `src/**` glob, no globstar in `sh`) — fixed.
- [x] **DBML editor: make automatic edits explicit and configurable** — done 2026-10-02.
      ⚙ in the editor status bar lists what the editor does on its own (`BehaviourSettings.svelte`,
      `behaviourPrefs.svelte.ts`, per browser): format (never — default / on save), completion
      while typing, bracket closing, sync delay (0.4–2 s or **Ctrl+S only**). Sync indicator in
      `StatusBar.svelte` (`Synchronisé` / `En attente` / `Erreur ligne n`). Verified by the second
      scenario of `e2e/dbml-editing.e2e.ts`. **Left out, deliberately:** "propagated rename
      (ask / always)" — no automatic rename exists to configure (F2 always shows the occurrence
      count and asks); retyping a table name by hand is still a delete + add for the server.
      The settings use button groups, to be swapped for `SegmentedControl`/`Switch` when the
      components below exist.
- [ ] **UI tokens and theme** — **M**. Single token file in `apps/web/src/styles/` (semantic
      colours incl. `--danger`, `--warning`, `--locked`; 4 px spacing scale; radii; shadows;
      motion durations; type scale), light/dark derived from the same tokens. Extend
      `components/dev/ComponentCatalogue.svelte` into the living showcase (every component, every
      state, both themes).
- [ ] **Custom form components** — **L**. In `apps/web/src/components/ui/` (today: `Button,
Input, Field, Card, Badge, Tabs, List*, Skeleton*, EmptyState`): `Select`/`Combobox`
      (search, groups, icons, keyboard), `Menu` (replaces `ToolbarMenu`, `InsertToolDropdown`,
      `DetailLevelDropdown` and the ad-hoc menus), `Checkbox`, `Radio`, `Switch`, `NumberInput`,
      `TextArea`, `PasswordInput`, `Popover`, `Tooltip`, `Toast`, `ConfirmDialog` (danger level,
      "retype the name" — already used for DROP), `DataGrid` (virtualised; replaces
      `ResultGrid.svelte`), `Splitter` (resizable, remembered per user), `SegmentedControl`.
      Accessible (ARIA, focus, keyboard) — add Playwright coverage in `apps/web/e2e/`.
      Open: headless base (Bits UI / Melt UI) vs. fully in-house.
- [ ] **Forbid native controls** — **S**, after the components exist. A local ESLint rule
      rejecting raw `<select>` and `<input type="checkbox|radio|number|date">` in `features/**`;
      today ~19 files use `<select>` and ~43 use `<input>`. Migrate screen by screen (Phase 37),
      listing the remaining files here as they shrink.
- [x] **Copy / paste tables on the canvas** — done 2026-10-02. `Ctrl/Cmd+C` / `Ctrl/Cmd+V`
      and Copy / Paste in the canvas context menu (`canvas/tableClipboard.ts`,
      `hooks/canvasClipboard.svelte.ts`, `pasteTables` in `projectMutations.ts`). Colours, size,
      detail level, columns, indexes and notes are kept; only the name changes (`_copy`, `_copy2`…
      — `Ctrl+D` now uses the same rule and no longer produces two `x_copy`). Goes through the
      **system clipboard** as DBML + one marker comment line, so it pastes across projects and
      tabs, and as text into the DBML editor. Bound to the `copy` / `paste` DOM events, so it
      works without the async Clipboard API (plain-http self-hosting) and one paste is one undo
      step. **Decisions taken** (the item left them open): a relation between two copied tables
      follows the copies (without its waypoints); a relation to a table that was not copied is
      **dropped**; `Ctrl+V` puts the copies 24 px off the originals (further on each repeat),
      context-menu Paste puts the group at the cursor; comments are not copied. The clipboard
      is untrusted input: rebuilt field by field, capped at 200 tables.
      **Verified:** `tableClipboard.test.ts`, `e2e/canvas-clipboard.e2e.ts` (real browser: copy,
      paste ×3, clipboard text, reload, undo). **Not done:** enums / zones / notes are not
      copied (still `Ctrl+D` only) — an enum-typed column pasted into another project keeps the
      type name without the enum; plain DBML from elsewhere cannot be pasted onto the canvas
      (needs the parser, i.e. a server round-trip — paste it in the DBML editor); the pasted
      tables are not selected afterwards; context-menu Paste outside a secure context only
      knows this tab's last copy. When Phase 30 lands: a copy of a locked table is not locked
      (nothing to do — locks will be keyed by table name).
- [ ] **Simplify waypoint create/move/delete on a relation line** — **M**. Still the same
      mechanism: `EdgeWaypoints.svelte`/`edgeRouting.svelte.ts` choose select-vs-insert by cursor
      proximity (`candidatePoint`) with only a preview dot as feedback. Needs hands-on iteration on
      the real canvas or the user's steer before redesigning.
- [ ] **Auto-detect a relation pointing the "wrong" way** — **S-M**, needs a decision first.
      No such heuristic exists; a false-positive warning on a legitimate schema is worse than none.

## Phase 30 — Governance: table locks and "structure via the schema" (plan §3, §4)

**Needs first:** the role matrix (Prerequisites). Server is the source of truth for both
features; the UI only mirrors it.

- [ ] **Table locks (data model + enforcement)** — **L**. Migration: `table_locks(project_id,
table_name, level, reason, locked_by, locked_at)`; levels `structure` (no column / type /
      constraint change) and `full` (+ seed + deletion). New permission `table.lock.manage`;
      audit `table.lock|unlock` (`shared/audit.ts`). **Enforce on every write path** — project
      routes (`modules/projects/routes/crud.ts`, `importExport.ts`), `/api/v1`, DBML import, the
      realtime room (`apps/server/src/realtime/room.ts` — a locked table's patch from a client
      must be rejected or reverted), plugins. A diff touching a locked table is rejected
      **whole**, listing the tables in cause; error `TABLE_LOCKED` + i18n key
      (`i18n/serverErrorMessages.ts`, `ERROR_CATALOG`). Lower roles keep read access to structure,
      contents and seeds. **Open:** per-column locks (start table-only); can a project admin lift an
      instance-admin lock (proposal: no).
- [ ] **Table locks (editor UI)** — **M**. 🔒 on `TableNode.svelte` with greyed border and
      hidden edit handles; context-menu entries disabled with an explanation (rename, delete, add
      column) and, for admins, "Verrouiller…" opening a dialog (level, reason, who can unlock);
      locked table text is a **read-only range** in CodeMirror (hatched, tooltip); a "Verrous"
      list for admins (table, level, by, date, reason, unlock); lock changes propagate live to
      collaborators. **Blocked by:** Phase 29 `ConfirmDialog` / `Popover` (can start with the
      existing `Modal`).
- [ ] **Structure policy per connection** — **M**. In `ConnectionEditModal.svelte`
      (`features/admin/connections/`) and an instance default in Admin → Paramètres:
      `schema-only` (default, redirect), `warn` (allowed after strong confirmation, marked
      "hors schéma" in the audit), `free` (today's behaviour); "also apply to free SQL" toggle;
      a connection may be stricter than the default, never looser unless the instance admin
      decides; changes audited. **Open:** per connection, per project, or both (stricter wins);
      is the existing `read-only` flag a special case of `schema-only`.
- [ ] **Intercept structural actions in the console** — **M**. Explorer drops (column / table
      / view / database, `StatementModal.svelte`) and free SQL go through `modules/dbAdmin/
sqlGuard.ts`, which already classifies statements — extend it to flag `CREATE|ALTER|DROP`
      on `TABLE|COLUMN|INDEX|VIEW` as _structural_. The intercepted action opens a dialog
      "Ouvrir dans le schéma ➜" that jumps to the linked project with the object (even a column)
      selected — extend `scrollToTable` of `DbmlEditor`. A connection with no project offers
      "Créer un projet depuis cette base" (`NewProjectFromDatabaseModal.svelte`).
- [ ] **Drift banner after an out-of-schema action** — **S**. When policy is `warn`/`free` and
      a structural action ran, show "La base a divergé du schéma (n différences) — Voir /
      Resynchroniser" in the editor, reusing `editor/compare/` and `pull.ts`. **Blocked by:**
      schema fingerprint (Prerequisites).

## Phase 31 — Workspace, SQL in the editor, history (plan §0, §6, §19)

- [ ] **Workspace shell with tabs** — **L**. `features/workspace/WorkspaceShell.svelte`: bar
      with project, environment pill (red on production), connection selector, collaborators,
      Deploy; tabs **Schéma · Données & SQL · Déploiements · Historique** plus admin-only
      **Utilisateurs · Sessions**. Route `/projects/:id/:tab` in
      `features/projects/projectRouting.svelte.ts`. Schéma = today's `ProjectEditor.svelte`;
      Données & SQL = explorer + console reused from `features/admin/connections/`. The redirects
      of Phase 30 become tab changes with the object selected. **Blocked by:** Phase 29 tokens.
- [ ] **Extract shared SQL components** — **M**. Move `SqlPanel.svelte`, `ResultGrid.svelte`
      (→ `DataGrid`) and the history UI from `features/admin/connections/` to `features/sql/`;
      `services/dbAdminApi.ts` keeps its API.
- [ ] **SQL panel in the schema editor** — **L**. Collapsible bottom panel (`Ctrl+J`,
      `Splitter`), connection selector among those linked to the project, environment guard, run /
      history / CSV; "Voir les données" on a table (context menu) inserts `SELECT * … LIMIT 100`;
      clicking a table name in a result selects it in the graph; SQL autocomplete fed by the
      **project schema** (no round-trip). DDL typed here follows the Phase 30 interception.
      **Permissions decision needed:** the console is `requireAdmin` today. Proposal: members with
      editor role get **read-only** SQL on linked connections (READ ONLY transaction, row/time
      caps, `connectionBudget`, audited); data writes need an explicit right; structure never.
      Replace the console's plain `<textarea>` by a **CodeMirror SQL editor with completion**
      (open item of the console follow-ups, Phase 27).
- [ ] **Undo / redo and visual history** — **M**. Today: `features/editor/history/`
      (`HistoryPanel`, `DiffSummary`), revisions in `modules/projects/routes/revisions.ts`, Yjs
      `UndoManager`. Wanted: per-user undo in collaboration (only your own changes), history list
      with visual diff preview on the graph, restore = new revision (never rewrite history),
      partial restore ("only this table"), markers for deployments / locks / published versions /
      drift, grouping of keystroke micro-edits, and **restore refused if it would change a locked
      table**. **Open:** retention / compaction of detailed revisions; whether undoing a deployed
      change proposes a new deployment.

## Phase 32 — Environments, backups and safe deployment (plan §11, §12, §13)

Builds on Phase 27's deployment machinery (`modules/connections/deploy.ts`,
`deploymentHistory.ts`, `DeploymentModal.svelte`). **Phase 27's rule applies to every item
here: each gets its own security review before it is closed.**

- [ ] **Configurable environment pipeline** — **L**. Replace the free-text
      `db_connections.environment` label by references to configurable stages: tables
      `environments(id, name, colour, protection, position)` and `project_environments`;
      Admin → Environnements to add / rename / reorder stages (`DEV › PreProd › Non-Prod › Prod`
      or any chain), instance default + per-project override; exactly one stage flagged
      _production_ (red everywhere, auto backup before deploy, retype-the-name confirmation).
      Migration must map existing labels onto stages without breaking history. Closes the Phase 27
      item "multi-target promotion".
- [ ] **Pipeline tab and promotion** — **L**. Per project: stages with version, connection and
      status; **Promote vN →** deploys the same schema version to the next stage with the **real**
      diff of the target (introspection, not only what changed in the project); no stage skipping
      without an explicit, audited right ("urgent fix"); each promotion is a deployment-history
      entry and can alert. Per-stage guards: deployment windows / freeze, mandatory backup,
      required approval, "must have succeeded on the previous stage".
      **Blocked by:** pipeline stages; workspace shell for the tab.
- [ ] **Compare environments** — **M**. "PreProd ⇄ Prod" diff list with per-line "Promouvoir"
      and flags for objects that exist only in the target ("hors schéma"). Reuse
      `editor/compare/` and the fingerprint. **Blocked by:** fingerprint.
- [ ] **Per-environment variables** — **M**. `{{schema}}`, `{{table_prefix}}`, `{{tablespace}}`
      per stage, substituted at DDL generation, with a check that blocks the deployment when a
      variable is used but undefined. Open: encrypted secret variables.
- [ ] **Destructive-change detection in the deployment plan** — **M-L**. Computed in the
      dry-run (`DeploymentModal.svelte`) from the diff plus **aggregate** sampling queries on the
      target (counts, min/max — never row data): `DROP TABLE/COLUMN`, length / precision
      reduction beyond the current max, `NOT NULL` over existing NULLs, new `UNIQUE`/PK over
      duplicates, incompatible type change, new FK over orphans, rename seen as drop+add (needs
      stable ids). Severity 🔴/🟡; accepted risks recorded in deployment history (who, when,
      why); per-stage blocking (a 🔴 untreated blocks Prod); option "save the column before".
      Respects `connectionBudget`, bounded in time.
- [ ] **Deployment rollback with inverse script** — **L**. Button "Revenir avant ce
      déploiement" in the history: inverse script computed from the **before/after fingerprints**
      (not guessed), data-loss list, option to back the data up first, schema rolled back as a new
      revision, irreversible cases flagged. Today's `rollbackGenerator.ts` is the starting point —
      check how it relates before building. **Blocked by:** fingerprint; backups.
- [ ] **Logical backups** — **XL**. New `modules/backups/`: export structure + data **through
      the driver** (SQL / CSV per table, streamed) for all engines incl. SQLite; manual and
      scheduled (daily / weekly / monthly retention), size limit shown, destinations local dir and
      S3-compatible (SFTP later), AES-256 encrypted with a key derived from the instance secret
      (compatible with `rotate-secret`), checksum, background job with progress / cancel,
      `connectionBudget` respected, weekly **restore test** into a scratch database with row
      counts. Tables `backups`, `backup_schedules`, `restore_jobs`, `storage_targets`; config
      `ATHANORDB_BACKUP_*`. **Automatic backup before a Prod deployment.**
      **Blocked by:** job runner. Open: size cap for logical mode, who pays for storage, legal
      retention of backups holding personal data.
- [ ] **Restore** — **L**. Whole database or chosen tables; to the same database, another
      connection or a new database; preview of what is overwritten / lost; automatic safety backup
      first; retype-the-connection-name; blocked on `read-only` connections, by the structure
      policy where it applies, and by table locks; right `backup.restore`; audited. Open: double
      approval for Prod.
- [ ] **Native backups and point-in-time (later)** — **XL**. Engine tools (`pg_dump`,
      `mysqldump`, `BACKUP DATABASE`, Data Pump) — needs the client tools in the image; archived
      logs (WAL, binlog) for point-in-time when the DBA configured them. This is the "backup/
      restore and data import" item of the console follow-ups (Phase 27).
- [ ] **Fine data rollback and unified timeline** — **L**. Restore a row range ("lines deleted
      between X and Y"); "Annuler cette requête" for small writes made from Athanor (keep the
      before-image under a row threshold); one timeline of deployments, backups, restores and
      external drifts with a return point at each step.
- [ ] **Deployment safety extras** — **S each**, unarbitrated: pre-deploy impact analysis
      (relations / views / indexes / seeds touched, lock-time estimate), deployment windows and
      one-click freeze, review-before-deploy (1–2 approvers) — see Phase 38.

## Phase 33 — Data: seeds and test data (plan §5, §14)

- [ ] **CSV seeds for tables** — **XL**. Entity `table_seeds(project_id, table_name, format,
file_ref, options_json, updated_at)`; an abstract `SeedSource` interface (`csv` first, then
      `json` / `xlsx` / `sql`); file stored server-side and **versioned with the project history**.
      Editor: "Données initiales" section in the table inspector — import, preview of the first
      rows, column mapping (separator, header, encoding), validation (types, NOT NULL, UNIQUE,
      FKs) **before** any deployment, 📄 icon on the node. CSV-formula-injection protection, size
      limit, encoding detection. Deployment: step added to `deploy.ts` after the DDL, inserting in
      **FK dependency order** (cycles detected and reported), in batches, in a transaction where
      the engine allows; per-table mode `insert-if-empty` (default) / `upsert` / `replace`; the
      dry-run lists `users : +248 lignes`. A seed inherits the `full` lock level (Phase 30).
      Open: size cap / streaming; mapping migration on column rename; DBML annotation syntax that
      stays valid DBML. **Blocked by:** locks (for the permission rule), workspace for the UI.
- [ ] **Export current data as a seed** — **S**, console → table → "Exporter comme données
      initiales" (CSV export already exists).
- [ ] **Test-data generation** — **L**. Inspector tab "Générer": volume, reproducible seed,
      locale, per-column generator (heuristic by name — `email`, `phone`, `iban`, `city` — plus a
      catalogue: names, addresses, dates, numbers, weighted enums, UUID, text, regex, fixed
      value, copy of another column), integrity (NOT NULL, UNIQUE, types, lengths, FKs in
      dependency order, simple CHECK). Destinations: save as seed, insert into a **non-production**
      connection (never Prod without an explicit right), CSV export. Batches, progress, cancel.
      Table `generator_configs`, versioned with the project, inherited/overridable by variants.
      Open: Faker-like library vs. in-house; volume cap in v1.
- [ ] **AI extension point for generation** — **S** (interface only), the AI itself is later.
      `DataGeneratorProvider { id; generate({table, rows, locale, hints?, seed?}): AsyncIterable<Row[]> }`
      in the style of `drivers/index.ts` / plugins; `builtin` is the only provider at first.
      Guard-rails designed in from day one: the provider receives **structure only, never real
      data**; enabled by the admin per instance or project; requests journalled; quotas; provider
      key encrypted like other secrets; **output re-validated by the same constraints** before
      insertion. Open: may a future AI see anonymised samples?

## Phase 34 — Observability: journal, drift, health, alerts (plan §8, §9, §17, §18)

**Needs first:** schema fingerprint, job runner, capability levels (Prerequisites).

- [ ] **Admin "Activité" tab** — **L**. One filterable view (source Athanor / Base; connection;
      user; type — structure · data · accounts · sessions · deployments; period; "hors Athanor
      uniquement"; search; CSV export) merging today's `AuditTab.svelte` and `ErrorsTab.svelte`;
      row detail panel (full SQL, duration, rows, IP, project, link to schema / deployment);
      cursor pagination. Server: extend `shared/audit.ts` with new event types (locks, structure
      policy, seeds, editor SQL, drift) and common fields `connection_id`, `project_id`,
      `correlation_id`; configurable retention; JSON/CSV export; optional hash-chain for a
      tamper-evident log. Reads stay out of the journal (as today).
- [ ] **External-change detection ("Surveillance" per project)** — **XL**. Project setting
      "Détecter les modifications externes à Athanor": interval (5 min … daily), scope
      (structure / + views, functions, procedures / + accounts and permissions), ignore list,
      alert channels, severity (critical on Prod connection), optional action "mark project
      divergent and block deployments". Mechanism: store the **reference fingerprint** after every
      successful deployment or pull; periodic re-introspection; on difference, look in
      `deployment_history` for a recent Athanor deployment that explains it, otherwise
      **external** (author and time when capability level 2 is available); event `drift.detected`;
      reference updated once resolved. Tables `schema_fingerprints`, `drift_events`,
      `monitor_settings`, `alert_acks`; routes `GET/PUT /api/projects/:id/monitoring`,
      `POST …/monitoring/check`, `GET …/drift`, `POST …/drift/:id/resolve`; also in `/api/v1` +
      `openapi.ts` (the sync test `openapi.test.ts` will fail until `docs/public-api.md` matches).
      A connection error is state "inconnu" + a separate "base injoignable" alert, never a false
      drift. Honours `connectionBudget` and `hostGuard`.
      **Open:** first scope = structure only; watch data (e.g. rows of a locked table)?; block
      deployments automatically while a drift is unresolved?
- [ ] **Drift UI** — **L**. Editor banner ("modifiée en dehors d'Athanor — n différences" with
      Voir / Mettre à jour le schéma / Réappliquer le schéma / Ignorer), differences page reusing
      `editor/compare/` with per-line Import / Revert / Ignore (ignore list = exceptions), "divergent"
      badge on nodes and a red dot on the project list, admin **alert centre** (bell, ack, history).
- [ ] **Alert channels and noise control** — **M**. In-app, e-mail (SMTP exists —
      `infrastructure/mailer.ts`), webhook (new event `drift.detected` in `modules/webhooks/`,
      signing and retries already there; update `docs/webhooks.md`). One alert per detection (not
      per table), grace delay, mute, acknowledge, reminder after N hours.
- [ ] **Database-side logs, levels 1–2** — **XL**. New `modules/dbMonitor/` with per-engine
      collectors next to `dbAdmin/drivers`. Level 1: sessions / recent statements
      (`pg_stat_activity` / `pg_stat_statements`, `performance_schema`, DMVs, `V$SESSION`); level
      2: DDL / audit trail only if the DBA configured it (PostgreSQL event trigger or log,
      MySQL `general_log` table / audit plugin, SQL Server Extended Events / default trace, Oracle
      unified audit). **Athanor never configures server-side audit itself** — it supplies the
      script and verifies it works. Table `db_activity_log` (short, capped retention; statement
      text truncated and literals masked). Capability map shown in the connection editor.
      Open: default retention; syslog / SIEM export.
- [ ] **Health dashboard** — **L**. "Santé" tab + card on the connections list: latency,
      version, uptime, size and growth per table, sessions, blocking locks (link to the sessions
      panel and its existing **kill**), slow statements (link to Phase 36). Short aggregated
      series kept server-side, rate-limited sampling.
- [ ] **Traffic: queries and data volume** — **L**, admin only, "if possible". Per connection:
      query count (by type), data **sent** (download) and **received** (upload), rows, per
      user / application / host (per-account breakdown off by default — it exposes account names).
      Sources by engine: MySQL `Questions`/`Com_*` + `Bytes_sent/received`
      (`status_by_account`); Oracle `user calls`/`execute count` + SQL*Net byte stats (`V$SYSSTAT`,
      `V$SESSTAT`); SQL Server `Batch Requests/sec` + `sys.dm_exec_connections` (partial);
      PostgreSQL `xact_commit/rollback` + `pg_stat_statements` — **no native network bytes**, volume
      is an estimate (rows × average row size) — and SQLite only via Athanor. Every figure carries
      an **accuracy badge** (exact / estimated / unavailable / measured by Athanor); never present
      an estimate as a measurement. **Athanor's own traffic is measured exactly and shown apart**
      ("Via Athanor"). Counters are cumulative → deltas, **ignore negative deltas** (server restart).
      Storage `connection_metrics(connection_id, bucket_start, resolution, queries, by_type_json,
bytes_out, bytes_in, rows_returned, quality)`, downsampled minute (7 d) → hour (90 d) → day
      (2 y). Open: accept an estimate for PostgreSQL?; threshold alerts; per-client chargeback.
- [ ] **Visual EXPLAIN** — **L**. "Expliquer" (plain `EXPLAIN`) and "Analyser" (`EXPLAIN
ANALYZE`, **read-only statements only**, explicit confirmation, time cap) in the SQL panel and
      console; per-engine normalisation (PostgreSQL / MySQL / SQL Server / Oracle; SQLite
      `EXPLAIN QUERY PLAN` simplified) into a node tree coloured by cost, estimated vs. actual rows,
      slowest node highlighted, raw text available. **Blocked by:** SQL panel (Phase 31).
- [ ] **Subscription notifications** — **L**. Follow a table, project, stage, variant, or
      "everything on Prod"; choose events (structure change, lock / unlock, seed change, drift,
      deployment — with stage, failed backup, new base version); channels in-app / e-mail /
      webhook; immediate or daily digest; never notify one's own change; never notify about what
      the user cannot see. Table `subscriptions(user_id, scope_type, scope_id, events_json,
channels_json, digest)`, routes `/api/subscriptions`, 🔔 on tables and a notification centre
      shared with drift alerts. **Subsumes** Phase 20 "Notifications" and Phase 21 "Comment
      mentions" — decide opt-out rules once, for all.

## Phase 35 — Derived projects: base + variants (plan §10)

A base project (e.g. **DeepDetect**) and variants (**L'Oréal**, **La Poste**) that inherit it,
customise it, and may target another engine. **Needs first:** stable ids, role matrix, locks.

- [ ] **Data model: base + overlay** — **XL**. `projects.parent_id`, `base_version`,
      `follow_mode` (`latest | pinned | detached`), `target_engine`; `project_versions(project_id,
version, snapshot_json, notes)` — a version is an explicit **"Publier vN"**, not every
      keystroke; `variant_ops(project_id, seq, op, target_id, payload_json)` storing structured
      operations (`addColumn`, `changeType`, `dropTable`, `renameColumn`, …). A variant's schema =
      parent @ version + overlay. One inheritance level at first; a variant can be **detached**
      into a standalone project. Routes `…/variants`, `…/variants/:id/resolve`, `…/merge`; also in
      `/api/v1` + `openapi.ts`. Open: DBML export of a variant (resolved only, or base + patch).
- [ ] **Variants UI** — **L**. Tree view in the project list (`Liste | Arbre`), "Nouveau ▾ →
      Variante d'un projet…"; breadcrumb in the editor with views **Résolu / Surcouche seule /
      Base**; graph states inherited (muted) / added ＋ / modified ~ / removed (hatched); editing an
      inherited element offers "pour ce client uniquement" (overlay op) or "dans la base" (impact
      analysis); a **variants matrix** (objects × variants, engine row, current stage column).
- [ ] **Base update merge** — **L**. When the base publishes vN+1: per-variant 3-way merge
      screen — non-conflicting changes auto-applied, conflicts resolved per line (keep variant /
      take base / edit); variants choose follow-latest (alert + merge), pinned, or detached.
      Notification through Phase 34 channels.
- [ ] **Engine per variant** — **L**. Type-mapping table per engine (extends
      `ConvertTypesModal.svelte` and `dbml-engine`), fidelity-loss warnings (no equivalent type,
      sequence vs. identity, case sensitivity), manual type override as an overlay op, and DDL
      generated for the **variant's** engine (the five drivers already exist).
- [ ] **Variants × the rest** — **M**. Locks inherited (a base lock holds in every variant;
      a variant can add its own); per-variant rights (a team manages "L'Oréal" without seeing "La
      Poste"); each variant has its own connections, environments chain, deployment history, seeds
      (overriding the base's), drift reference and linter rules (hardenable); recommendations from
      a client's Prod apply to its variant or are proposed to the base.
      **Open:** can a variant add a seed to a table locked in the base?; hierarchy depth later
      (base → sector → client).

## Phase 36 — Schema quality and performance (plan §15, §16)

- [ ] **Schema linter** — **L**. Extend `validateProject` (`dbml-engine`) and
      `editor/dbml/lint.ts`: built-in rules (PK present, FK indexed, snake_case naming, no
      `varchar` without length, `created_at`/`updated_at`, no `FLOAT` for money, table without
      description) with severity, profile (Souple / Standard / Strict / Perso), custom rules
      (name pattern, forbidden type, mandatory column), per-table exceptions (annotation
      `// lint-ignore: pk-required` and list), **quick fixes** only where safe (add PK `id`,
      create the FK index), "Problèmes" panel, squiggles + node badge, option to block deployment
      on error, `GET /api/v1/projects/:id/lint`. Variants inherit and can tighten rules.
- [ ] **Data dictionary** — **M**. Description, owner (user or team), **classification**
      (public / internal / personal / sensitive) and tags per table and column, stored **in the
      schema** (DBML `Note`s) so history and variants follow; "Dictionnaire" page with completeness
      indicator and a lint rule for undocumented tables; export HTML (static site with diagram),
      PDF, CSV, Markdown. Optional AI-assisted filling later. Prepares RGPD classification and
      masking (Phase 38).
- [ ] **Index suggestions and clean-up** — **L**. Ranked list (impact) of indexes to create
      (from analysed queries + stats), duplicates / redundant, and unused ones (`pg_stat_user_
indexes`, `sys.dm_db_index_usage_stats`, `performance_schema`, Oracle views) with an
      adjustable duration threshold and a warning when stats were **reset recently**; also unused
      tables / columns. **Never applied directly:** each suggestion becomes a _pending change in
      the schema_ ("＋ proposé") that follows the normal path (review, plan, promotion, backup).
      Generated DDL adapted to the engine (`CREATE INDEX CONCURRENTLY`, `ONLINE = ON`, size / time
      estimate). **Blocked by:** health dashboard (Phase 34) and the query collection below.
- [ ] **Query advisor (opt-in per connection, off by default)** — **XL**. Detect SQL
      statements run on a database and propose (a) **query rewrites** and (b) **database changes**.
  - _Activation:_ admin-only, off on Prod until explicitly confirmed; sources (engine stats —
    `pg_stat_statements`, `events_statements_summary_by_digest`, Query Store /
    `dm_exec_query_stats`, `V$SQL` — plus statements run from Athanor; slow-query log
    optionally); sampling interval, retention (default 14 d), "slow" threshold; privacy
    toggles (replace literals by `?`, never store parameters); `EXPLAIN ANALYZE` never / on
    demand read-only, with a load budget (~2 %).
  - _Collection:_ normalise + fingerprint each statement, aggregate calls / total / mean time /
    rows / plan. Reuses level 1 of the DB-side logs.
  - _Analysis, three layers:_ (1) rewrite — `SELECT *`, function on an indexed column
    (`lower(email)`), leading `LIKE '%x'`, implicit cast, `NOT IN` with NULL, correlated
    subquery → join, deep `OFFSET` → keyset, superfluous `DISTINCT`/`ORDER BY`, **N+1** bursts,
    join without condition; (2) plan — full scan on a big table, disk sort, badly wrong
    estimates, costly nested loops; (3) database — missing / redundant / unused index (column
    order, covering, partial), mismatched join types, stale statistics (`ANALYZE`), table to
    partition, materialised view or denormalisation for a repeated aggregate, big `text`
    column read everywhere.
  - _Output:_ ranked recommendations with before / after diff, cause, **confidence level**
    (🟢 plan observed … estimate); impact estimate from measured times, and for indexes a
    hypothetical-index check where the engine allows (`hypopg` on PostgreSQL) — otherwise
    labelled "estimation". Ignore button remembered; no recommendation on too few samples.
  - _Apply:_ a rewrite replaces the text only for statements living **in Athanor**; for an
    external application it is "copy" with the diff (Athanor cannot see app code). Database
    changes go through "Proposer dans le schéma" (see index suggestions). A recommendation
    seen on a client's Prod is scoped to that **variant** or proposed to the base.
  - _Guard-rails:_ statistics-view reads only, bounded budget and interval, `connectionBudget`
    honoured; statements may contain personal data → normalise at collection, short retention,
    admin only, audited; turning it off **stops collection and purges** what was collected.
  - _Optional AI:_ `QueryAdvisorProvider` interface; it gets only the **normalised** statement,
    table structure and plan — never values or data — and its proposals are re-validated
    (parse, result-equivalence on a sample when possible, `EXPLAIN` of the result) before being
    shown with a confidence level.
  - _Open:_ multi-dialect SQL parser (`node-sql-parser` vs. an in-house analyser limited to
    `SELECT`); show recommendations (without statement text) to non-admins; measure the real
    before / after gain of a deployed index.
    **Blocked by:** DB-side logs level 1, visual EXPLAIN, index suggestions, variants (for the
    scoping rule).

## Phase 37 — Visual overhaul (plan §7)

Runs alongside the other phases once the Phase 29 components exist; each screen is its own PR
with before / after captures. **Open:** do it before the new features or in parallel (plan
proposes in parallel, core components first); Figma mock-ups before implementation?

- [ ] **Auth screens** (`features/auth/`) — showcase for the new style.
- [ ] **Project list** (`projects/ProjectListScreen.svelte`) — tree-ready, densities.
- [ ] **Toolbar and canvas** (`ProjectToolbar.svelte`, `canvas/*Toolbar*`) — menus on the new
      `Menu`.
- [ ] **Panels** — DBML, history, comments, settings.
- [ ] **Database console and administration** (`admin/connections/*`, `admin/*`).
- [ ] **Modals** — everything through `Modal` + `ConfirmDialog`.
- [ ] **Cross-cutting principles** — one hierarchy (surface → card → row), comfortable /
      compact density, short consistent transitions, illustrated empty states, loading skeletons,
      first-class dark mode, `prefers-reduced-motion`. Closes Phase 22's "visually out of step" and
      feeds its accessibility audit.

## Phase 38 — Candidate ideas, not yet arbitrated

Proposed 2026-10-02; **none is decided** — the owner reviews them one by one. Numbers are those
of the discussion. Cut or promote into a phase above.

- **Change safety:** 1 review-before-deploy (approvers on Prod) · 2 deployment windows and
  freeze · 3 pre-deploy impact analysis.
- **Data:** 10 anonymisation rules (PROD → DEV copies) · 12 row editor in the explorer · 13
  saved / shared queries with parameters · 14 relation explorer (follow FKs row to row).
- **Schema:** 20 table templates (audit columns, soft delete, multi-tenant).
- **Governance:** 21 RGPD classification + "where is personal data" report · 22 dynamic masking
  for non-admins · 23 just-in-time elevated access · 24 exportable audit report.
- **Integration:** 25 CLI + CI/CD (overlaps Phase 27 "Phase E") · 26 Git sync of the DBML ·
  27 migration generation (Flyway, Liquibase, Prisma, Alembic, Knex — as plugins, see Phase 21)
  · 28 code generation (types, ORM models, DTOs, API client) · 29 internal / public schema
  documentation site.
- **Collaboration:** 30 anchored comments with resolution · 31 schema branches (close to
  Phase 35 — decide whether variants cover it) · 33 diagram presentation mode.
- **Observability:** 35 threshold alerts · 36 table-size history.
- **UX:** 37 global command palette (`Ctrl+K`) · 38 cross-search (schemas, queries, journal) ·
  40 customisable shortcuts and synced preferences.

---

## Existing open items from earlier phases

### Phase 6 — Multi-user editing

- [~] **Field-level CRDT merge within one table** — **S-M**, low priority. Two users editing
  different fields of the _same_ table still last-write-wins: `getTablesMap` in
  `packages/shared/src/yjsBinding.ts` stores each table as one opaque `Y.Map` entry. **How:**
  one Yjs sub-entry per field — touches `yjsBinding.ts`, `apps/server/src/realtime/room.ts`
  and every web mutation doing `tablesMap.set(id, {...current, ...patch})`. Revisit only if
  reported. **Note:** the table-lock enforcement of Phase 30 touches the same code — decide
  together.

### Phase 17 — Plugin system

- [ ] **Plugin-provided UI** — **L**, speculative: a plugin renders its own HTML in a sandboxed
      iframe over `postMessage` (today `PluginHost.ts`/`sandboxRuntime.ts` only run sandboxed
      exporter / importer functions). Not worth it until a real plugin needs more than a settings
      form.
- [ ] **Server-installed / team-shared plugins** — **M**, deliberately deferred: plugins live in
      one browser's `localStorage`; sharing means the server storing third-party code — a trust-
      model change.
- [ ] **Plugin publishing / discovery** — **M**. Blocked by the item above.

### Phase 19 — Security

- [ ] **Passkeys / WebAuthn** — **L**. No code yet; TOTP covers the shorter 2FA effort.

### Phase 20 — Accounts

- [ ] **Notifications** — **M**. Nobody is told they were added to a project/team or that a
      comment got a reply (`CommentThread.svelte` has no `@mention`). `sendMail` and
      `shared/emailTemplates.ts` exist; what's left is which events notify and a per-user opt-out.
      **Folded into Phase 34 "Subscription notifications"** — do it there.
- [ ] **Per-project/team roles beyond view/edit/administrator** — **M**, only on real demand.
      **Related:** the role matrix prerequisite and Phase 30 locks may force this earlier.

### Phase 21 — Product

- [ ] **Comment mentions / notifications** — **M**. Threads exist, `@user` doesn't; depends on
      the Phase 20 / 34 notifications decision.
- [ ] **Export to other ecosystems** (Prisma, TypeORM, GraphQL SDL, JSON Schema) — **M each**,
      as plugins, deliberately not core.
- [ ] **Not done on the API:** per-key usage quotas, multi-project key scoping, request
      validation from the OpenAPI schemas; webhooks: secret rotation (delete + recreate), webhooks
      via `/api/v1`.

### Phase 22 — UX

- [ ] **Landing page and app visually out of step** — **M**; revisit with a browser pass (see
      Phase 37).
- [ ] **Mobile / tablet: decide, don't drift** — **S** to document, **XL** to build. Svelte Flow
      assumes a wide pointer screen. Undecided.
- [ ] **Accessibility audit** — **M-L**. No systematic contrast / keyboard / screen-reader check
      has been run on the Svelte UI. Do it once the Phase 29 components exist.

### Phase 23 — Code health

- [~] **File-size watchlist** (2026-09-23 counts; split opportunistically, none is a bug):
  `packages/dbml-engine/src/dbml.ts` 504 l. · `features/plugins/communityTemplates.ts` 722 l.
  (mostly data) · `features/editor/dbml/symbols.ts` 566 l. · `features/connections/
DeploymentModal.svelte` 501 l. (will grow with Phase 32 — split first) ·
  `features/editor/canvas/autoLayout.ts` 465 l. · `features/editor/canvas/CanvasArea.svelte`
  463 l. · `features/editor/ProjectEditor.svelte` 459 l. (gets the workspace shell in Phase 31) ·
  `features/admin/connections/UsersPanel.svelte` 447 l. · `apps/server/src/modules/connections/
repository.ts` has grown a lot with instance-level connections — worth a look.
- [ ] **Confirm two perf regressions flagged by the Svelte migration bench** — **S**
      (`docs/perf/svelte-migration-results.md`, single pass): `zoom-links-on` at "complet" detail
      0→29 ms blocking at 100 tables and 4→40 ms at 500; `delete-columns` at 500 tables +~6 ms. Small
      in absolute terms; needs a second measurement pass.

### Phase 25 — Release process

- [~] **Versioning / git tags** — SemVer decided (`0.y.z` until the V1 checklist clears),
  documented in `CHANGELOG.md`; `git tag -l` is still empty and every workspace is `0.0.1`.
  Cutting the first tagged release is a deliberate release action.

### Phase 27 — Live database link & deployment

Connects a project to a real database: read-only introspection, drift detection, migration SQL
generation, apply / rollback with per-environment history
(`apps/server/src/modules/connections/`,
`packages/dbml-engine/src/{migrationDiff,migrationGenerator,rollbackGenerator}.ts`,
`DeploymentModal.svelte`). Connections are instance-level since 2026-10-02 and managed in the
admin console (`apps/web/src/features/admin/connections/`, `apps/server/src/modules/dbAdmin/`).
**This is the one area where a mistake can destroy a client's data — each remaining gap needs
its own security review before being closed, not an audit afterwards.**

- [~] **Residual security gaps** — **M**:
  - **SQL Server / Oracle connection strings** and a PostgreSQL / MySQL URL carrying its own TLS
    options (`sslrootcert`, `?ssl=`) are **checked but not pinned** to the resolved address
    (rewriting would drop options). DNS rebinding is otherwise closed (`targetPinning.ts`).
  - `ATHANORDB_SQLITE_DIR` is **opt-in**; making it the default is a breaking change to schedule.
  - A general private-IP-range block — deliberately not default (a self-hosted DB is often on
    `localhost` / LAN).
  - Audit what `sampleData` / risk-inspection queries can leak across a permission boundary
    (also relevant to Phase 32 destructive-change sampling).
  - An independent security review by someone who hasn't been staring at this code — owed for
    Phase F (users & permissions), the Ref-direction change below, and every Phase 32 item.
  - MySQL: no way to roll back _through_ a mid-batch failure (DDL auto-commits).
  - Orphan rows from before the project-delete fix: one-off cleanup `DELETE … WHERE project_id
NOT IN (SELECT id FROM projects)` is worth running on existing instances (migration 18
    already drops connections whose project is gone).
  - Nothing stops an admin from locking or dropping the connection's **own** account (Phase F).
  - Column-level grants are readable but not grantable from the UI (Phase F); declaring intended
    grants in the project so drift covers permissions is still open.
- [ ] **Phase E — CI/CD automation** — **L**. The `/api/v1` deploy-trigger endpoint is the
      primitive; the GitHub Action, CLI wrapper and docs aren't built. Overlaps Phase 38 idea 25.
- [ ] **Database console follow-ups** — from `docs/plan-db-admin.md` phase 4: data **import**,
      schema comparison **between two connections** (now covered by Phase 32 environment
      comparison), SSH tunnel and custom CA for TLS (drivers connect with
      `rejectUnauthorized: false` unless a PostgreSQL URL says otherwise), CodeMirror SQL editor with
      completion (Phase 31), MongoDB. SQLite queries run synchronously and cannot be timed out.
      Backup / restore moved to Phase 32.

### Phase 28 — Canvas feedback

- **Still owed (Phase 27 rule):** the Ref-direction fix changed deployment SQL — have someone else
  review it before the next real deployment, even though every path is tested. The remaining open
  items of this phase (waypoints, wrong-way relation, copy / paste) moved to Phase 29.

---

## Done (condensed)

- **Phase 6** — DBML-panel resync data-loss bug (`documentSync` + three-way merge
  `preserveConcurrentAdditions`, `concurrentEdits.ts`); committed multi-user regression test
  (`importExport.concurrency.test.ts`).
- **Phase 10** — Docker build verified on a real daemon (`node:22-bookworm-slim`), graceful
  `SIGTERM`.
- **Phase 11 / 16** — Unit, integration (REST + WS) and browser E2E tests (`apps/web/e2e/`,
  shared `harness.ts`); route-level `routes.test.ts` for every module; user docs, contributing,
  `SECURITY.md`, `CHANGELOG.md`; lint and CI; `@dbml/core` 10.1.0, Vite 8; `npm audit` clean.
- **Phase 13 / 19** — Rate limiting, scrypt cost, session cleanup, CSRF origin check, lockout,
  audit log, TOTP 2FA, account disable / delete, **self-service password reset** (SHA-256 token
  storage, 1 h TTL, single use, cooldown, identical answer for unknown addresses).
- **Phase 20** — Configurable session length; **transactional e-mail** (`infrastructure/
mailer.ts`, `ATHANORDB_SMTP_*`, `ATHANORDB_PUBLIC_URL`; _not verified_ through a real
  third-party relay — one manual send worth doing); invitation delivery by e-mail.
- **Phase 21** — **Public API** `/api/v1` + **OpenAPI** (`GET /api/v1/openapi.json`, drift caught
  by `openapi.test.ts`); **webhooks** (`modules/webhooks/`, `docs/webhooks.md`, signed, retry
  queue, SSRF-safe at connect time); **project templates** (4 starters, `TemplatePickerModal`);
  **cross-project diff** (`CompareProjectsModal.svelte`); **global multi-project search**
  (`GET /api/search`).
- **Phase 22** — Light theme, `<svelte:boundary>`, loading placeholders.
- **Phase 23** — Code-splitting, Prettier gate, circular-dependency lint, complexity lint,
  `CONTRIBUTING.md` table; component catalogue (`/#components`); `realtime/room.ts` split; lint
  cleanup; DBML default expressions keep their backticks on round trip (`Field.defaultKind`).
- **Phase 24** — `/api/health`, scheduled backups of the app database with retention, Docker
  Compose, logging with request ids, `GET /api/metrics`, error tracking (`error_log`).
- **Phase 25** — GDPR export / deletion / retention, self-hosted Google Fonts, reverse-proxy
  guidance.
- **Phase 27** — DNS-rebinding closed for host/port configs and PG/MySQL URLs; `ATHANORDB_SQLITE_
DIR`; project-scoped connection access fixed; per-target rate limiting (`connectionBudget.ts`);
  project-delete cascade of connections; instance-level connections + Oracle (migration 18);
  **database console** — explorer, SQL console, drops behind a SQL preview, session monitor with
  kill, read-only flag, CSV export, audit (migration 19); **Phase F users & permissions** for
  PostgreSQL, MySQL / MariaDB, SQL Server, Oracle (live tests in `dbAdmin/drivers/live.test.ts`);
  encryption key rotation (`rotate-secret`).
- **Phase 28** — **Ref direction** (`from` = FK column, `to` = referenced; `refOrientation.ts`,
  serializer, display, Mermaid, `Room` repair of inverted refs); settings popovers; table-block
  reorder survives resync (`TABLE_ORDER_KEY`); `Ctrl+F` in the DBML editor; cardinality glyphs and
  relation reversal; canvas responsiveness after a DBML edit.
- **Also shipped** — New project from database, table duplication (`Ctrl/Cmd+D`), Check
  differences between a project and a connected database.

---

## Open decisions (revisit as needed)

- **Auth model** — resolved: e-mail / password with sessions, per-project / team permissions,
  invitations, admin console. No external IdP.
- **Canvas library** — resolved 2026-09-22: React Flow → **Svelte Flow** with the full Svelte 5
  rewrite (−58 % blocking time, −36 % mount time, −7 % critical-path bundle; see
  `docs/perf/svelte-migration-results.md`).
- **History storage** — Yjs update log + periodic SQLite snapshots.
- **SQLite as a SQL import / export dialect** — `@dbml/core` can't import it; export ships as the
  example plugin; import would need a dedicated DDL parser — not planned unless asked.
- **Plugin trust model** — sandboxed Worker + per-browser install, no server-side plugin store.
- **Desktop-only or responsive?** — undecided (Phase 22).
- **Is "local-first" the architecture or the marketing?** — the marketing; all state is server-
  side. Real offline persistence would be a new architecture.
- **Is there a hosted product?** — the landing page marks "Cloud géré" as not yet available; if it
  ships it pulls billing, tenancy and an SLA into scope.
- **i18n** — now French **and English** (`apps/web/src/locales/{fr,en}.json`; the console work
  added both); keep both complete for every new string. _(Earlier text said "all-French, no i18n
  library" — superseded.)_
- **New (2026-10-02), see `docs/plan-schema-workbench.md`:** environments and variants are two
  orthogonal axes (variant = _for whom_, environment = _where in the life cycle_); structure goes
  through the schema by default and the admin may relax it; AI features are optional, off by
  default, and only ever see structure or normalised statements — never real data.
