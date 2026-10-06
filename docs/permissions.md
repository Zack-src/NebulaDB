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

| Action                                                                                                                           | view | edit | administrator |
| -------------------------------------------------------------------------------------------------------------------------------- | :--: | :--: | :-----------: |
| Open the project, read schema, history, comments, team list                                                                      |  ✔   |  ✔   |       ✔       |
| Export DBML / SQL / image; compare with another project you can read                                                             |  ✔   |  ✔   |       ✔       |
| See cursors and presence (realtime)                                                                                              |  ✔   |  ✔   |       ✔       |
| Edit the schema on the canvas or in the DBML editor (realtime)                                                                   |      |  ✔   |       ✔       |
| Import DBML / SQL into the project                                                                                               |      |  ✔   |       ✔       |
| Set or remove a table's initial data (CSV seed); a `full` lock freezes it                                                        |      |  ✔   |       ✔       |
| Read the schema linter's rules and findings (`GET …/lint`, `/api/v1/…/lint`)                                                     |  ✔   |  ✔   |       ✔       |
| Follow the project, read one's own notifications about it                                                                        |  ✔   |  ✔   |       ✔       |
| Be notified of a deployment or rollback (when following them)                                                                    |      |      |       ✔       |
| Write a comment that mentions someone / be offered `@` suggestions                                                               |      |  ✔   |       ✔       |
| Be told one was mentioned, or replied to, in a comment (followed or not)                                                         |  ✔   |  ✔   |       ✔       |
| Read the project's pipeline (`GET …/pipeline`)                                                                                   |      |      |       ✔       |
| Use `{{variables}}` in table names (a schema edit)                                                                               |      |  ✔   |       ✔       |
| Compare two of the project's databases with each other                                                                           |      |      |       ✔       |
| Read or export the data dictionary (`/api/v1/…/dictionary`)                                                                      |  ✔   |  ✔   |       ✔       |
| Fill in the data dictionary (it writes notes: a schema edit; locks apply)                                                        |      |  ✔   |       ✔       |
| Apply a lint fix (it is a schema edit; locks apply)                                                                              |      |  ✔   |       ✔       |
| Choose the lint profile, rule levels, exceptions, custom rules, "errors block deployment" (this makes the project's own version) |      |      |       ✔       |
| Follow a lint preset of the library, or the instance default (drops the project's own version)                                   |      |      |       ✔       |
| See which lint preset a project follows (`GET …/lint` `source`)                                                                  |  ✔   |  ✔   |       ✔       |
| List the presets on offer (`GET …/lint` `presets`)                                                                               |      |      |       ✔       |
| Label a revision; restore a revision (whole or some tables), the snapshot                                                        |      |  ✔   |       ✔       |
| Rename, archive, trash, restore from trash, delete the project                                                                   |      |      |       ✔       |
| Grant or revoke a team on the project                                                                                            |      |      |       ✔       |
| Webhooks: list, create, edit, delete, test, read deliveries                                                                      |      |      |       ✔       |
| Database connections of the project: add, edit, remove, test                                                                     |      |      |       ✔       |
| List the project's connections (names and hosts, never the password)                                                             |  ✔   |  ✔   |       ✔       |
| Give, change, remove one's own account on a connection that asks for it                                                          |      |      |       ✔       |
| Pull a schema from a database; plan, apply and roll back a deployment                                                            |      |      |       ✔       |
| Deploy to / roll back on the production stage (connection name retyped)                                                          |      |      |       ✔       |
| Read deployment history                                                                                                          |      |      |       ✔       |
| See deployments and rollbacks on the history timeline                                                                            |      |      |       ✔       |
| See that a linked database was changed outside the schema (the banner)                                                           |  ✔   |  ✔   |       ✔       |
| Check what differs in the database; resynchronise; dismiss the banner                                                            |      |      |       ✔       |
| Watch (Déploiements → Surveillance): turn on / off, pace, ignored tables, check now                                              |      |      |       ✔       |
| See what the watch found about the structure                                                                                     |  ✔   |  ✔   |       ✔       |
| Be told the watch found accounts changed (database name and count, no names)                                                     |      |      |       ✔       |

Any account can create a project (and becomes its owner), create one from a database it has
the credentials for, list the projects it can read, and search across them.

A connection created in the admin console is managed there: a project administrator can use it
when it is linked to the project, not edit or delete it (`CONNECTION_MANAGED_BY_ADMIN`).

Reading a table's rows from a linked database as a seed to review
(`POST …/seeds/:tableId/from-database`) needs **instance administrator** as well as `edit`:
it hands out every row of the table, like the console. Saving the result is the ordinary seed
route above.

Deploying to a stage before the one ahead of it has the schema (`skipStageOrder`) needs
**instance administrator** on top of project `administrator`, and a reason; it is audited.

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

- Accounts: list, reset a password, disable / enable, delete; invitations: create (with the
  teams to join and the database access to give on acceptance), list, revoke.
- Teams: create, rename, delete, add and remove members, read a team's members. (Any account
  can read the list of team names, to grant one on a project it administers.)
- The library of lint presets (Admin → Lint): create, edit, delete, make one the default, apply one to
  projects (`/api/admin/lint-presets`). A preset's settings are rules only; an administrator who applies it
  to a project replaces that project's own version.
- Audit log and error log.
- The database console, except what a database access grant opens below: instance-level
  connections (create, edit, delete, link to projects, health), drops, database users and
  permissions, sessions and kill, write-mode SQL that changes structure. The explorer, SQL and
  query history are theirs on every connection, and a member's on the connections granted.
- Database access grants: give, change, remove (per user, per team, in an invitation), and
  the database account name proposed to a person.
- A database's **journal** (console → Journal): its entries in the audit log and their export,
  the people who appear in it, and the SQL console's figures per statement shape
  (`GET /api/admin/connections/:id/journal/actors`, `…/query-stats`). Opening the console and
  testing a connection are written to it — a member's opening too.
- The **accounts watch** of a project (Déploiements → Surveillance): turning it on or off
  (`PUT /api/projects/:id/monitoring/accounts`), its state and findings — they name the
  database's accounts, so `GET …/monitoring` leaves them out for everyone else, project
  administrators included — and accepting the accounts as last read as the new reference
  (`POST …/monitoring/accounts/accept`). Its reads use the connection's stored account.
- Backups of a connected database: take, list, download, pin, delete, restore. A project
  `administrator` deploying to the production stage _causes_ a backup (taken before the
  deployment) and sees in the deployment history that one exists, but cannot list, download or
  restore it.

**Whose database account.** A connection is used with the one account stored on it, or — when
an instance administrator sets it to personal accounts — with the account each user gave
(`PUT /api/connections/:id/credentials`: instance administrators, administrators of a
project the connection is attached to, and members granted access to it below, from a browser
session; anyone else is answered `404`). The name an administrator proposed (`suggestedUsername`)
pre-fills that dialog; the password is always the person's own. In that mode Athanor's
roles decide who may _ask_ for an action, and the database's own permissions, on that person's
account, decide whether it happens. A person with no account is refused
(`PERSONAL_CREDENTIALS_REQUIRED`), never connected as the stored account, which only unattended
work uses: the watch (also when a check is asked for by hand), scheduled backups, the health
check. Only an instance administrator changes the mode, and can see who gave an account — never
the passwords.

An instance administrator can also **give a person their account**: an existing one
(`PUT /api/admin/users/:userId/connections/:id/credentials`, tried before it is kept; the person
must have access to the database, or be an instance administrator), one created for each missing
account (`POST /api/admin/users/:id/db-accounts`, `…/teams/:id/db-accounts`), or — in the console's
Utilisateurs section — the account being created, handed to an Athanor user in the same step. The
person finds it in Paramètres → Bases de données and gives it a password of their own
(`PUT /api/connections/:id/credentials/password`): Athanor changes it on the database, signed in as
that account, so the old password is never asked for and no other account can be reached. Browser
session only; refused on a connection marked read-only.

Being an instance administrator does not by itself mean "anything goes" in the console: on a
database attached to a project, table and index changes follow the **structure policy** (refused
and sent to the schema by default, allowed after confirmation, or free), which only an instance
administrator can set — for the instance, or per connection.

The console refuses to drop, lock or change the password of **the account the connection
signs in with** (its stored account, one named in its connection string, and — in personal
mode — the caller's own), on the preview already: `409 DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED`.

Every account can manage itself: display name, password, two-factor authentication, its own
sessions, its own API keys, export of its data, deletion of its account.

## Database access (members)

An instance administrator grants a **user** or a **team** (its members inherit) a level on one
connection: `read` or `write` (`db_access_grants`, `modules/dbAccess/`). Nothing else gives it —
being a member, an editor or an administrator of a project the database is attached to does not.
Checked on the server at every request (`requireDbConsoleUser`), so removing a grant, a team
membership or the team applies to the next request. A member's grant works from a browser
session only; with an API key the connection does not exist (`404`). Several grants: the
highest level wins. The routes are `/api/connections/:id/{overview,schemas,tables,table,rows,
query,query-history}`, shared with instance administrators (who keep their full rights there).

| Action on a granted connection                                                  | read | write | instance administrator |
| ------------------------------------------------------------------------------- | :--: | :---: | :--------------------: |
| Explorer: databases, schemas, tables, a table's rows and structure              |  ✔   |   ✔   |           ✔            |
| SQL, read-only (one reading statement, READ ONLY transaction, 1 000 rows, 30 s) |  ✔   |   ✔   |           ✔            |
| Own query history                                                               |  ✔   |   ✔   |           ✔            |
| SQL data write (`INSERT` / `UPDATE` / `DELETE` / `MERGE`, one, `confirmWrite`)  |      |   ✔   |           ✔            |
| SQL changing structure, accounts, permissions; procedures; `SELECT … INTO`      |      |       |  ✔ (structure policy)  |
| Drops from the explorer; database users and permissions; sessions; backups      |      |       |           ✔            |
| Raise the row / time ceilings (5 000 rows, 120 s)                               |      |       |           ✔            |
| Give one's own account on the connection when it asks for personal accounts     |  ✔   |   ✔   |           ✔            |
| Change the password of one's own account there, on the database itself          |  ✔   |   ✔   |           ✔            |

- A member's SQL is screened before it reaches the database: `read` with the read-only rules,
  `write` with a stricter data-only rule (`sqlGuard.ts#assertDataStatement`); a refusal is
  recorded in the history and the audit trail like any attempt. Every query is audited
  (`dbaccess.query`, with the level), the statement text, never the result.
- The structure policy is not consulted for a member: structure is refused whatever it says.
- A connection marked read-only stays so (`CONNECTION_READ_ONLY`).
- In personal-account mode the member runs as **their own** database account, and without one
  is refused (`PERSONAL_CREDENTIALS_REQUIRED`). In shared mode they run as the connection's
  stored account — whose own permissions are then the real bound (see `docs/todo.md`).

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

- No level between `edit` and `administrator` ("can deploy but not manage teams"). Phase 32's
  promotion rights need one. (SQL for members is a per-connection grant, above — not a project
  level.)
- No per-table or per-column **read** restriction: who can open a project can read all of it;
  who is granted a database can read all of what its account can.
- Database access is per connection only: not per database, schema or table on that server.
