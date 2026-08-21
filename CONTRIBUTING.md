# Contributing to AthanorDB

## Getting set up

```bash
npm install
npm run bootstrap-admin -- you@example.com 'something long'
npm run dev
```

`npm install` builds `packages/shared` and `packages/dbml-engine` through the
root `postinstall` — everything else depends on those, so a build error there
is the first thing to check when an import looks broken.

`npm run dev` starts the API on `:3001` and Vite on `:5173`; the web app proxies
`/api` and `/ws` to the server. Node 22–25 (see `engines`); `better-sqlite3`
ships prebuilt binaries for those versions, so a toolchain is only needed if
`npm install` falls back to building it from source.

## Before you push

```bash
npm run lint && npm run build && npm test
```

CI runs exactly these three, on Node 22. `npm run format:check` is deliberately
not a gate yet — the repo predates Prettier and ~100 files fail it; enabling it
belongs in the same change that reformats them.

## Layout

| Path                   | What lives there                                                    |
| ---------------------- | ------------------------------------------------------------------- |
| `packages/shared`      | The `Project` schema, the Yjs binding, and the shared entity limits |
| `packages/dbml-engine` | DBML/SQL parsing, serialisation, diffing, validation                |
| `apps/server`          | Fastify REST + the WebSocket sync rooms + SQLite persistence        |
| `apps/web`             | React canvas editor, DBML panel, dashboard, plugin host             |
| `docs/`                | Implementation tracker, V1 roadmap, user guide                      |

Two rules that are easy to break by accident:

- **Keep serialisation parser-free.** `packages/dbml-engine/src/dbml.ts`
  instantiates an `@dbml/core` parser at module scope. Anything the web app
  imports must not reach it, or the whole parser (~11 MB) lands in the browser
  bundle. `serialize.ts`, `diff.ts` and `validate.ts` exist for that reason.
- **Permissions are enforced server-side.** The WebSocket sync path applies its
  own permission check per frame (`apps/server/src/realtime/room.ts`); hiding a
  control in the UI is not a permission.

## Reach for this before writing that

A primitive below already exists to solve the problem it names. Grep for a
component that already uses it and copy its shape rather than writing a
parallel version — this is the actual recurring source of duplication in this
codebase: a hook built once, then hand-rolled again in the next component
because nobody knew it was there.

| Need                                            | Use                                               | Not                                         |
| ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| Inline rename / edit-in-place with Enter/Escape | `hooks/useDraftValue.ts`                          | a component-local `onKeyDown` commit block  |
| Close a popover on Escape or click outside it   | `hooks/useDismissablePopover.ts`                  | separate `mousedown`/`keydown` listeners    |
| Close _anything_ on Escape only                 | `hooks/useEscapeKey.ts`                           | `window.addEventListener("keydown", ...)`   |
| Close on click outside (non-canvas context)     | `hooks/useOutsideClick.ts`                        | a manual `mousedown` listener + ref check   |
| A persisted user preference (`localStorage`)    | `utils/storage.ts`                                | raw `localStorage.getItem`/`setItem`        |
| Any HTTP call to the API                        | `services/*Api.ts` (add a module if missing)      | a raw `fetch()` inside a component          |
| An async action with loading/error state        | `hooks/useAsyncAction.ts` / `useAsyncResource.ts` | a bespoke `loading`/`error` `useState` pair |
| A transient status line that clears itself      | `hooks/useFlashMessage.ts`                        | a message `useState` + its own timer ref    |

Popovers inside the React Flow canvas specifically need `click`, not
`mousedown` — the pane calls `stopPropagation()` on `mousedown` for its own
pan/drag handling, so a `mousedown` listener never sees a click on the canvas
itself. `useDismissablePopover` and `useOutsideClick` already account for
this; don't rediscover it by shipping a popover that stays open when the
canvas is clicked.

If you add a new cross-cutting primitive, add its row here in the same PR —
an unlisted hook gets reimplemented by the next person who needs it.

## Dev-only routes

Two pages are `lazy()`-loaded and hash-routed straight from `main.tsx`,
bypassing auth and project loading entirely — a normal session never fetches
either chunk:

- `/#bench?tables=500&columns=8&detail=full` — the real editor over a
  synthetic schema, WebSocket swapped for a local pre-seeded doc. Use this to
  check whether a canvas change regresses performance; see
  `docs/perf/canvas-perf-2026-08-20.md` for how to read the numbers and
  `scripts/bench-web.mjs` to run the comparative driver against it.
- `/#components` — every `components/ui/` primitive, every variant, on one
  page, with a dark/light toggle. Check it after touching a shared primitive
  (`Button`, `Card`, `Tabs`, …) instead of hunting down every screen that uses
  it. Deliberately not Storybook — same reasoning as `/#bench` not being a
  separate visual-testing tool: one more page in the existing stack, not a
  second build toolchain.

Both are real UI, so both are still bound by "Reach for this before writing
that" and the i18n lint rule above — dev-only doesn't mean exempt.

## Tests

Every workspace uses plain `node:test` — no vitest, no jest, no jsdom.

- `packages/*` and `apps/server` compile with `tsc` and run `node --test` over
  `dist`.
- `apps/web` runs `tsx --test` directly over `src`, and covers **pure logic
  only** (layout maths, DBML symbol parsing, shortcut matching). The canvas,
  individual components, and the plugin sandbox are still verified by hand —
  no jsdom or component-testing library is in yet; see `docs/todo.md`'s
  browser-test-tooling item before adding one, so this doesn't get decided
  three separate times.
- `apps/web/e2e/*.e2e.ts` is the one exception: a real end-to-end flow (create
  project → edit schema on the canvas → reload → verify persistence), driven
  with `playwright-core` against the actual built app in a real browser —
  not pure logic, and deliberately not part of `npm test` (needs
  `npm run build` first, and a Chrome/Edge install). Run it with
  `npm run test:e2e`. Read the file's own header comment before adding a
  second one — the selectors it had to work around (an always-present search
  `<input>` before the one you actually want, a forbidden `fetch()` port) are
  exactly the kind of thing that's cheap to avoid once and easy to rediscover
  the hard way otherwise.

Write tests for logic that can be exercised without a browser; say so in the PR
when something could only be checked manually, and say what you actually ran.

**Live database drivers** (`apps/server/src/modules/connections/drivers/`):
the Postgres and MySQL driver tests need real throwaway instances — spin them
up with `docker compose -f docker-compose.test.yml up -d` before running
`npm test`. Without that running, those two test files skip themselves with
an explanatory message rather than failing; CI always runs them for real (see
the `services:` block in `.github/workflows/ci.yml`). The SQLite driver test
needs no setup — it runs against `:memory:`.

## Database changes

Schema changes go in `apps/server/src/infrastructure/migrations.ts` as a new entry in
`MIGRATIONS` — never as an ad-hoc `ALTER` elsewhere. Each `up()` guards itself
(check the column/table before adding it) so a database that reached the shape
another way is safe, and `PRAGMA user_version` tracks what has run.

## Commit and PR conventions

Explain _why_ in the commit body when the change isn't self-evident, and keep
`docs/todo.md` honest: it records what was verified and how, including what was
deliberately left undone. An entry claiming more than was actually checked is
worse than no entry.

## Reporting security problems

Don't open a public issue — see [SECURITY.md](./SECURITY.md).
