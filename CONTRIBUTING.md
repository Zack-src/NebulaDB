# Contributing to AthanorDB

## Getting set up

```bash
npm install
npm run bootstrap-admin -- --email you@example.com --password 'something long'
npm run dev
```

`npm install` builds `packages/shared` and `packages/dbml-engine` through the
root `postinstall` — everything else depends on those, so a build error there
is the first thing to check when an import looks broken.

`npm run dev` starts the API on `:3001` and Vite on `:5173`; the web app proxies
`/api` and `/ws` to the server. Node 20–23 (see `engines`); `better-sqlite3`
compiles natively, so a toolchain is required on first install.

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

Popovers inside the React Flow canvas specifically need `click`, not
`mousedown` — the pane calls `stopPropagation()` on `mousedown` for its own
pan/drag handling, so a `mousedown` listener never sees a click on the canvas
itself. `useDismissablePopover` and `useOutsideClick` already account for
this; don't rediscover it by shipping a popover that stays open when the
canvas is clicked.

If you add a new cross-cutting primitive, add its row here in the same PR —
an unlisted hook gets reimplemented by the next person who needs it.

## Tests

Every workspace uses plain `node:test` — no vitest, no jest, no jsdom.

- `packages/*` and `apps/server` compile with `tsc` and run `node --test` over
  `dist`.
- `apps/web` runs `tsx --test` directly over `src`, and covers **pure logic
  only** (layout maths, DBML symbol parsing, shortcut matching). Anything
  needing a DOM is currently verified by hand.

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

Schema changes go in `apps/server/src/migrations.ts` as a new entry in
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
