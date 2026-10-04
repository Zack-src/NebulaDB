# Who can do what

One page, role × action, taken from the guards in the code — not from intent. When a route
changes its guard, change this page in the same commit.

Where it is enforced: `apps/server/src/shared/guards.ts` (`requireUser`, `requireAdmin`,
`requireProjectAccess`, `requireProjectAdmin`), `shared/permissions.ts`
(`getEffectivePermission`), `modules/tableLocks/access.ts` (locks), `modules/apiKeys/auth.ts`
(API-key scopes), and the WebSocket gate in `app.ts` + `realtime/room.ts`. The web app hides
what a user cannot do, but nothing below depends on that: every rule is checked on the server.

## Roles

There are two axes, and no others.

**Instance** — one flag on the account (`users.is_admin`).

| Role                   | How you get it                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Instance administrator | `npm run bootstrap-admin`, or an invitation issued with admin on. |
| Member                 | Any other account. Accounts only exist by invitation.             |

**Project** — a level per project, resolved for each request (`getEffectivePermission`):

| Level           | How you get it                                                                              |
| --------------- | ------------------------------------------------------------------------------------------- |
| `administrator` | Instance administrator (always) · the project's owner (always) · a team granted this level. |
| `edit`          | Member of a team granted `edit` on the project.                                             |
| `view`          | Member of a team granted `view` — **or anyone**, when the project has no team at all.       |
| none            | The project has at least one team, and you are in none of them.                             |

- With several teams, the highest level wins.
- A project with **no team assigned is readable by every account** on the instance. Assigning
  the first team is what makes it private. This is the default most worth knowing.
- The owner is whoever created the project (`projects.owner_id`); a restored backup can have
  none, in which case only an instance administrator can manage it.

## Projects

| Action                                                                       | view | edit | administrator |
| ---------------------------------------------------------------------------- | :--: | :--: | :-----------: |
| Open the project, read schema, history, comments, team list                  |  ✔   |  ✔   |       ✔       |
| Export DBML / SQL / image; compare with another project you can read         |  ✔   |  ✔   |       ✔       |
| See cursors and presence (realtime)                                          |  ✔   |  ✔   |       ✔       |
| Edit the schema on the canvas or in the DBML editor (realtime)               |      |  ✔   |       ✔       |
| Import DBML / SQL into the project                                           |      |  ✔   |       ✔       |
| Set or remove a table's initial data (CSV seed); a `full` lock freezes it    |      |  ✔   |       ✔       |
| Read the schema linter's rules and findings (`GET …/lint`, `/api/v1/…/lint`) |  ✔   |  ✔   |       ✔       |
| Compare two of the project's databases with each other                       |      |      |       ✔       |
| Read or export the data dictionary (`/api/v1/…/dictionary`)                  |  ✔   |  ✔   |       ✔       |
| Fill in the data dictionary (it writes notes: a schema edit; locks apply)    |      |  ✔   |       ✔       |
| Apply a lint fix (it is a schema edit; locks apply)                          |      |  ✔   |       ✔       |
| Choose the lint profile, rule levels, exceptions, "errors block deployment"  |      |      |       ✔       |
| Label a revision; restore a revision (whole or some tables), the snapshot    |      |  ✔   |       ✔       |
| Rename, archive, trash, restore from trash, delete the project               |      |      |       ✔       |
| Grant or revoke a team on the project                                        |      |      |       ✔       |
| Webhooks: list, create, edit, delete, test, read deliveries                  |      |      |       ✔       |
| Database connections of the project: add, edit, remove, test                 |      |      |       ✔       |
| List the project's connections (names and hosts, never the password)         |  ✔   |  ✔   |       ✔       |
| Pull a schema from a database; plan, apply and roll back a deployment        |      |      |       ✔       |
| Deploy to / roll back on the production stage (connection name retyped)      |      |      |       ✔       |
| Read deployment history                                                      |      |      |       ✔       |
| See deployments and rollbacks on the history timeline                        |      |      |       ✔       |
| See that a linked database was changed outside the schema (the banner)       |  ✔   |  ✔   |       ✔       |
| Check what differs in the database; resynchronise; dismiss the banner        |      |      |       ✔       |

Any account can create a project (and becomes its owner), create one from a database it has
the credentials for, list the projects it can read, and search across them.

A connection created in the admin console is managed there: a project administrator can use it
when it is linked to the project, not edit or delete it (`CONNECTION_MANAGED_BY_ADMIN`).

Reading a table's rows from a linked database as a seed to review
(`POST …/seeds/:tableId/from-database`) needs **instance administrator** as well as `edit`:
it hands out every row of the table, like the console. Saving the result is the ordinary seed
route above.

## Table locks

A lock freezes a table's **structure** — its name, columns, types, constraints, indexes, note,
the foreign keys it carries, and its existence. It does not freeze how the table looks:
position, size, colour, detail level and comments stay editable by anyone with `edit`.

A lock has an **authority**: `project` (the default) or `instance`.

| Action                                                   | view | edit | project administrator | instance administrator |
| -------------------------------------------------------- | :--: | :--: | :-------------------: | :--------------------: |
| See that a table is locked, by whom, and why             |  ✔   |  ✔   |           ✔           |           ✔            |
| Move, recolour, comment on a locked table                |      |  ✔   |           ✔           |           ✔            |
| Change the structure of a table under a `project` lock   |      |      |           ✔           |           ✔            |
| Place, change or lift a `project` lock                   |      |      |           ✔           |           ✔            |
| Change the structure of a table under an `instance` lock |      |      |                       |           ✔            |
| Place, change or lift an `instance` lock                 |      |      |                       |           ✔            |

- The rule holds on every way of writing a schema: the canvas and DBML editor (realtime), DBML
  / SQL import, revision and snapshot restore, pull from a database, and the same routes under
  `/api/v1` — where the lock routes themselves exist too (`/api/v1/projects/:id/locks`), with
  the rights of this table plus a `projects:write` scope. A REST change that touches a locked table is **refused whole** (`TABLE_LOCKED`,
  with the tables in cause); a realtime change is applied and immediately put back, since a
  shared document has no way to refuse one.
- Another table gaining a foreign key **to** a locked table is allowed: it alters the other
  table. Renaming a column that a locked table's foreign key points at is allowed too.
- The two levels, `structure` and `full`, are enforced alike today. `full` will additionally
  cover the table's initial data when seeds exist (Phase 33).
- A copy of a locked table is not locked. Deleting the project deletes its locks; deleting the
  account that placed a lock does not lift it.

## Instance administration

Instance administrator only (`requireAdmin`) — a project `administrator` has none of these:

- Accounts: list, reset a password, disable / enable, delete; invitations: create, list,
  revoke.
- Teams: create, rename, delete, add and remove members, read a team's members. (Any account
  can read the list of team names, to grant one on a project it administers.)
- Audit log and error log.
- The database console, entirely: instance-level connections (create, edit, delete, link to
  projects, health), explorer, free SQL, drops, database users and permissions, sessions and
  kill, query history.
- Backups of a connected database: take, list, download, pin, delete, restore. A project
  `administrator` deploying to the production stage _causes_ a backup (taken before the
  deployment) and sees in the deployment history that one exists, but cannot list, download or
  restore it.

Being an instance administrator does not by itself mean "anything goes" in the console: on a
database attached to a project, table and index changes follow the **structure policy** (refused
and sent to the schema by default, allowed after confirmation, or free), which only an instance
administrator can set — for the instance, or per connection.

Every account can manage itself: display name, password, two-factor authentication, its own
sessions, its own API keys, export of its data, deletion of its account.

## API keys (`/api/v1`)

A key acts **as the account that created it**, never as more: the tables above apply first.
The key's scopes then narrow it further, and a key restricted to one project is refused
everywhere else.

| Scope                 | Needed for                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `projects:read`       | Listing and reading projects, exports, history, connections, deployments. |
| `projects:write`      | Creating, renaming, deleting a project; import; team grants.              |
| `connections:manage`  | Adding, editing, removing, testing a connection; pull.                    |
| `deployments:trigger` | Deploying and rolling back.                                               |
| `teams:manage`        | Team routes. Everything but listing also needs an instance administrator. |

Table locks apply to `/api/v1` writes exactly as above; placing and lifting locks is not
exposed under `/api/v1` yet.

## Not covered by any role today

Listed so that the features planned in `docs/todo.md` add to this page rather than invent
their own rules:

- No level between `edit` and `administrator` ("can deploy but not manage teams", "can run
  read-only SQL"). Phase 31's SQL panel for non-admins and Phase 32's promotion rights need one.
- No per-table or per-column **read** restriction: who can open a project can read all of it.
- The database console is all-or-nothing on the instance flag; there is no per-connection
  grant.
