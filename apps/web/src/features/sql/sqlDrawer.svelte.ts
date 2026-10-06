import type { DatabaseConnectionSummary, Table } from "@nebuladb/shared";
import { previewRowsStatement } from "@/features/sql/previewStatement";
import { readBoolean, readNumberInRange, writeBoolean, writeString } from "@/utils/storage";

const OPEN_KEY = "nebuladb.sqlDrawer.open";
const WIDTH_KEY = "nebuladb.sqlDrawer.width";

interface SqlDrawerInput {
  /** The workspace's current connection. */
  connection: () => DatabaseConnectionSummary | null;
  /** Whether this user may query it at all — the console's rule. */
  allowed: () => boolean;
  /** Whether the drawer's place (the schema tab) is showing: its shortcut only listens there. */
  visible: () => boolean;
}

/**
 * The SQL drawer beside the diagram: the console's SQL panel, within reach of
 * the schema. Offered to exactly those the console is offered to; open /
 * closed and width are remembered per browser.
 */
export class SqlDrawerState {
  static readonly MIN_WIDTH = 300;
  static readonly MAX_WIDTH = 960;

  open = $state(readBoolean(OPEN_KEY, false));
  width = $state(readNumberInRange(WIDTH_KEY, SqlDrawerState.MIN_WIDTH, SqlDrawerState.MAX_WIDTH, 460));
  /** A statement to run as soon as the drawer shows; `token` tells two identical requests apart. */
  request = $state.raw<{ sql: string; token: number } | null>(null);

  constructor(private readonly input: SqlDrawerInput) {
    $effect(() => {
      if (!this.usable || !input.visible()) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j") {
          return;
        }
        // Deliberately also while typing: it is how one leaves the SQL editor for the diagram and comes back.
        event.preventDefault();
        this.setOpen(!this.open);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    });
  }

  /** There is a database to query and this user may query it. */
  get usable(): boolean {
    return this.input.allowed() && this.input.connection() !== null;
  }

  setOpen = (open: boolean): void => {
    this.open = open;
    writeBoolean(OPEN_KEY, open);
  };

  rememberWidth = (width: number): void => writeString(WIDTH_KEY, String(width));

  /** Opens the drawer on the first rows of a table. Stable identity: it is part of what the table node cache compares. */
  viewTableData = (table: Table): void => {
    const connection = this.input.connection();
    if (!connection) return;
    this.setOpen(true);
    this.request = { sql: previewRowsStatement(connection.engine, table), token: (this.request?.token ?? 0) + 1 };
  };
}
