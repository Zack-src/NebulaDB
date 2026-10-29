# Front-end conventions

How `apps/web/src` is laid out and what a screen is built from. The rules marked **(lint)** are
enforced by `eslint.config.js`; the rest are habits worth keeping.

## Layers

```
app/          the shell: routing between views, ErrorBoundary, WorkspaceShell (knows features)
features/     one folder per product area; may import from the layers below and from other features
components/   shared building blocks, no product knowledge
  ui/           controls and small pieces: Button, Input, Select, Table, NavItem, SettingSwitch…
  layout/       page-level blocks: PageHeader, PageContainer, PageIntro, PageToolbar, Navbar
  overlays/     Modal, ConfirmDialog, ContextMenu, tooltips, toasts
services/     one *Api.ts per backend area, on top of httpClient
hooks/        reusable reactive helpers (useAsyncResource, useAsyncAction…)
i18n/ utils/ actions/ types/   cross-cutting, below features
```

**(lint)** `components/`, `services/`, `hooks/`, `utils/`, `i18n/`, `actions/` and `types/` never import
from `@/features/*` or `@/app/*`. A shared part that needs a feature's type moves down instead.

## Inside a feature

A feature folder holds its screens at the top and one sub-folder per sub-area. Example:

```
features/admin/          AdminConsole.svelte, adminSections.ts (the shell of the console)
  users/                 UsersTab, InviteUserForm, the user modals, memberRows(+test)
  teams/ sso/ environments/ shareLinks/ logs/ lint/ access/ connections/
features/connections/    everything about a database connection
  form/                  the edit modal and its fields
  console/               the per-database console: explorer, journal, health, sessions, users, rows
  deployment/            deploying a schema: panel, steps, history, rollback
  personal/              the personal SQL account of a connection
```

Naming: `*Tab` is a page of the admin console, `*Panel` a block inside a screen, `*Modal` / `*Dialog` an
overlay, `*Card` a self-contained block of a workspace tab. Pure logic sits next to its screen in a plain
`.ts` file with a `.test.ts` beside it; reactive state classes are `*.svelte.ts`.

## Building a page

Every top-level page starts the same way:

```svelte
<PageContainer>                                  <!-- one width, 1200px -->
  <PageHeader title={…} icon={…} description={…}> <!-- icon chip, title, actions on the right -->
    {#snippet actions()}…{/snippet}
  </PageHeader>
  <PageIntro>what this page is for</PageIntro>   <!-- reading width -->
  <PageToolbar>filter · create button</PageToolbar>
  …list / table / cards…
</PageContainer>
```

- A list is `List` + `ListRow` + `ListMain`; the empty state is `EmptyState`; errors are `ErrorText`.
- A tabular page is `Table` with `TABLE_ROW` / `TABLE_CELL` on the rows. **(lint)** A raw `<table>` is
  refused in `features/`, except in the files grandfathered in `RAW_TABLE_NOT_MIGRATED` (data grids,
  previews, editable grids).
- A switch setting is `SettingSwitch` (same height as a list row); a side menu is `NavItem` under a
  `NavHeading`.
- Text fields are `Input` / `Field`; **(lint)** a raw `<input>` is refused except in
  `RAW_INPUT_NOT_MIGRATED` (hidden file pickers, in-canvas fields, palettes). Native `<select>`,
  checkbox, radio and number inputs are refused too (`NATIVE_CONTROLS_NOT_MIGRATED`).
- Those three lists only ever shrink: migrate a file, delete its line; never add one.

## Type, colour, width

- **(lint)** Font sizes come from the scale in `styles/tokens.css`: `text-micro` (10) · `text-caption` (11) ·
  `text-label` (12) · `text-body-sm` (12.5) · `text-body` (13) · `text-title` (14) · `text-heading` (16).
  No `text-[13px]`.
- Colours are tokens (`bg-surface`, `text-text-muted`, `border-border`, `text-primary`…), never hex.
- User-facing text goes through `t("key")` and lives in `locales/fr.json` + `en.json` **(lint)**.

## Adding or moving a file

- Put it with the feature that owns it, in the sub-folder for its role; if two features need it, it is a
  component or a hook, not an import between features.
- A new generic piece gets a section in `components/dev/ComponentCatalogue.svelte` (the e2e suite renders
  it in both themes and fails on console errors).
- Before pushing: `npx svelte-check`, `npx eslint apps/web/src`, `npm test -w apps/web`, and the e2e
  (`npm run build`, then `npm run test:e2e -w apps/web`) for anything that changes a screen.
