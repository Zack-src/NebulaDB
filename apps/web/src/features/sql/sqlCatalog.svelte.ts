import { untrack } from "svelte";
import type { DbAdminColumn, DbAdminTable, Table } from "@nebuladb/shared";
import { fetchTableDescription, fetchTables } from "@/services/dbAdminApi";
import { catalogKey, mergeCatalog, type SqlCatalogTable } from "./sqlCatalog";

interface SqlCatalogInput {
  connectionId: () => string;
  /** The database being queried; `undefined` on a server that only has the one. */
  database: () => string | undefined;
  /** `false` while the database to query is not known yet: nothing is asked of the server. */
  ready: () => boolean;
  /** The project's own tables, where the console sits in a project. */
  projectTables: () => readonly Table[];
}

const NO_COLUMNS: ReadonlyMap<string, readonly DbAdminColumn[]> = new Map();

/**
 * The tables and columns the SQL editor completes from, for one connection and
 * database. The table list is asked for once, and again when the database
 * changes or `reload` is called; the columns of a table once, the first time a
 * statement names it. Typing never sends anything by itself.
 *
 * A failed request is not reported: the editor then completes keywords and
 * whatever the project's schema knows, and the console says what is wrong with
 * the connection as soon as a statement is run.
 */
export class SqlCatalogState {
  #databaseTables = $state.raw<DbAdminTable[] | null>(null);
  #described = $state.raw(NO_COLUMNS);
  #reloadToken = $state(0);
  /** Tables whose columns were asked for — answered, pending or failed alike: each is asked once per load. */
  #requested = new Set<string>();
  /** Told apart by identity: an answer for a previous connection or database is dropped. */
  #load: object = {};
  /** One description at a time, so a pasted script naming fifty tables is not fifty requests at once. */
  #queue: Promise<void> = Promise.resolve();

  readonly tables: SqlCatalogTable[];

  constructor(private readonly input: SqlCatalogInput) {
    this.tables = $derived(mergeCatalog(this.#databaseTables, this.#described, input.projectTables()));
    $effect(() => {
      void this.#reloadToken;
      const connectionId = input.connectionId();
      const database = input.database();
      const ready = input.ready();
      const load = {};
      untrack(() => {
        this.#load = load;
        this.#requested = new Set();
        this.#databaseTables = null;
        this.#described = NO_COLUMNS;
      });
      if (!ready) return;
      fetchTables(connectionId, database)
        .then((tables) => {
          if (this.#load === load) this.#databaseTables = tables;
        })
        .catch(() => {});
    });
  }

  /** After a statement that may have changed the structure. */
  reload = (): void => {
    this.#reloadToken += 1;
  };

  /** Asks the database for the columns of these tables, unless it was already asked. */
  ensureColumns = (tables: readonly SqlCatalogTable[]): void => {
    const load = this.#load;
    const known = new Set(untrack(() => this.#databaseTables ?? []).map(catalogKey));
    const connectionId = untrack(this.input.connectionId);
    const database = untrack(this.input.database);
    for (const table of tables) {
      const key = catalogKey(table);
      // A table only the project has is not in the database to be described.
      if (!known.has(key) || this.#requested.has(key)) continue;
      this.#requested.add(key);
      this.#queue = this.#queue.then(async () => {
        if (this.#load !== load) return;
        try {
          const ref = { database, schema: table.schema ?? undefined, table: table.name };
          const { columns } = await fetchTableDescription(connectionId, ref);
          if (this.#load === load) this.#described = new Map(this.#described).set(key, columns);
        } catch {
          // Left as it is: the table still completes by name.
        }
      });
    }
  };
}
