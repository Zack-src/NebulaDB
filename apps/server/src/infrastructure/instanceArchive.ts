import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, renameSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type pg from "pg";
import { quoteDouble as quote } from "../shared/sqlQuoting.js";
import { MIGRATIONS } from "./migrations.js";

/**
 * Logical export / import of NebulaDB's own PostgreSQL data, in plain Node (the
 * runtime image has no `pg_dump`).
 *
 * Archive = one gzip'd JSONL file:
 *   1. `{"type":"header", ...}`  format, schema version, and per table its columns, in dependency order
 *   2. `{"t":"<table>","v":[...]}` one line per row, tables in header order, values aligned with the header's columns
 *   3. `{"type":"manifest", ...}` per table the row count and the SHA-256 of that table's row lines
 *
 * Values travel as the text PostgreSQL itself prints (BYTEA as base64), so
 * nothing is parsed into a JS type on the way. Secrets stay in the encrypted
 * form they are stored in: the archive restores only with the same
 * NEBULADB_SECRET.
 */

export const ARCHIVE_FORMAT = "nebuladb-instance-export";
export const ARCHIVE_VERSION = 1;

/**
 * Tables that are not exported: they only hold short-lived state, and restoring
 * them would resurrect stale logins or reset tokens. Nothing else may refer to
 * them (checked at export time).
 */
export const EPHEMERAL_TABLES: readonly string[] = [
  "sessions",
  "mfa_challenges",
  "login_attempts",
  "password_reset_tokens",
];

/** Rows read per round trip (keyset page) and written per INSERT. */
const PAGE_ROWS = 1000;
const INSERT_ROWS = 200;
/** The stages every new database starts with: an empty target may hold these and nothing else. */
const SEEDED_ENVIRONMENTS = ["DEV", "Prod", "Staging"];

export class InstanceArchiveError extends Error {}

export interface ArchiveColumn {
  name: string;
  /** `format_type`, used as the cast of the bound value on import. */
  type: string;
  bytea: boolean;
  /** GENERATED ALWAYS identity: needs OVERRIDING SYSTEM VALUE. */
  identityAlways: boolean;
  /** Any identity column (ALWAYS or BY DEFAULT). */
  identity: boolean;
}

export interface ArchiveTable {
  name: string;
  columns: ArchiveColumn[];
  primaryKey: string[];
  /** Columns referring to the same table: inserted NULL, filled in at the end. */
  selfRefs: string[];
}

export interface ArchiveHeader {
  type: "header";
  format: string;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  tables: ArchiveTable[];
}

export interface TableManifest {
  rows: number;
  sha256: string;
}

export interface ArchiveManifest {
  type: "manifest";
  tables: Record<string, TableManifest>;
}

export interface ExportResult {
  file: string;
  schemaVersion: number;
  tables: { name: string; rows: number }[];
}

/** Latest schema version this code knows. */
export function codeSchemaVersion(): number {
  return Math.max(...MIGRATIONS.map((m) => m.version));
}

/** A client whose values all stay text (BYTEA included, as `\x…` hex): the archive is exact, not interpreted. */
export function rawTypes(): pg.CustomTypesConfig {
  return { getTypeParser: (() => (value: string) => value) as pg.CustomTypesConfig["getTypeParser"] };
}

type Q = Pick<pg.ClientBase, "query">;

async function rows<T>(client: Q, text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query(text, values)).rows as T[];
}

// ---------------------------------------------------------------- schema discovery

interface ForeignKey {
  table: string;
  references: string;
  column: string;
}

async function discoverTables(client: Q): Promise<{ tables: ArchiveTable[]; schemaTables: string[] }> {
  const schemaTables = (
    await rows<{ table_name: string }>(
      client,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
  ).map((r) => r.table_name);
  const wanted = schemaTables.filter((t) => t !== "schema_migrations" && !EPHEMERAL_TABLES.includes(t));

  const keys = await rows<ForeignKey>(
    client,
    `SELECT c.conrelid::regclass::text AS "table", c.confrelid::regclass::text AS "references", a.attname AS "column"
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`,
  );
  // regclass::text quotes names that need it; the schema here only has plain ones.
  const clean = (name: string) => name.replace(/^"|"$/g, "");
  for (const key of keys) {
    key.table = clean(key.table);
    key.references = clean(key.references);
    if (wanted.includes(key.table) && EPHEMERAL_TABLES.includes(key.references)) {
      throw new InstanceArchiveError(
        `${key.table}.${key.column} refers to the ephemeral table ${key.references}: adjust EPHEMERAL_TABLES`,
      );
    }
  }

  // Referenced tables first.
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visit = (table: string, path: Set<string>) => {
    if (placed.has(table)) return;
    if (path.has(table)) throw new InstanceArchiveError(`foreign keys form a cycle through ${table}`);
    path.add(table);
    for (const key of keys) {
      if (key.table === table && key.references !== table && wanted.includes(key.references)) {
        visit(key.references, path);
      }
    }
    path.delete(table);
    placed.add(table);
    ordered.push(table);
  };
  for (const table of wanted) visit(table, new Set());

  const tables: ArchiveTable[] = [];
  for (const name of ordered) {
    const columns = (
      await rows<{ name: string; type: string; bytea: boolean; identity: string }>(
        client,
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
                (a.atttypid = 'bytea'::regtype) AS bytea, a.attidentity AS identity
           FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
          ORDER BY a.attnum`,
        [quote(name)],
      )
    ).map((c) => ({
      name: c.name,
      type: c.type,
      bytea: String(c.bytea) === "t",
      identityAlways: c.identity === "a",
      identity: c.identity !== "",
    }));
    let primaryKey = (
      await rows<{ name: string }>(
        client,
        `SELECT a.attname AS name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary
          ORDER BY array_position(i.indkey::int2[], a.attnum)`,
        [quote(name)],
      )
    ).map((r) => r.name);
    const selfRefs = keys.filter((k) => k.table === name && k.references === name).map((k) => k.column);
    if (primaryKey.length === 0) {
      // Log-like tables (health samples…) have no key but an identity `seq`, unique by construction.
      const seq = columns.find((c) => c.name === "seq" && c.identity);
      if (!seq || selfRefs.length > 0) {
        throw new InstanceArchiveError(
          `${name} has no primary key nor identity seq: the export cannot page through it`,
        );
      }
      primaryKey = ["seq"];
    }
    tables.push({ name, columns, primaryKey, selfRefs });
  }
  return { tables, schemaTables };
}

async function currentSchemaVersion(client: Q): Promise<number> {
  const row = (await rows<{ v: number | string | null }>(client, "SELECT MAX(version) AS v FROM schema_migrations"))[0];
  return Number(row?.v ?? 0);
}

// ---------------------------------------------------------------- export

function encodeValue(column: ArchiveColumn, value: string | null): string | null {
  if (value === null) return null;
  return column.bytea ? Buffer.from(value.slice(2), "hex").toString("base64") : value;
}

/**
 * Writes the whole instance to `file` (gzip'd JSONL). Reads in one
 * REPEATABLE READ transaction — a consistent snapshot while the server keeps
 * running — and pages by primary key, so memory stays flat whatever the size.
 *
 * `client` must be connected and built with {@link rawTypes}.
 */
export async function exportInstance(
  client: pg.Client,
  file: string,
  log: (line: string) => void = () => {},
): Promise<ExportResult> {
  const partial = `${file}.partial`;
  const result: ExportResult = { file, schemaVersion: 0, tables: [] };

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    result.schemaVersion = await currentSchemaVersion(client);
    const { tables } = await discoverTables(client);
    const manifest: ArchiveManifest = { type: "manifest", tables: {} };

    async function* lines(): AsyncGenerator<string> {
      const header: ArchiveHeader = {
        type: "header",
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        schemaVersion: result.schemaVersion,
        exportedAt: new Date().toISOString(),
        tables,
      };
      yield JSON.stringify(header) + "\n";

      for (const table of tables) {
        const hash = createHash("sha256");
        let count = 0;
        let last: (string | null)[] | undefined;
        const select = table.columns.map((c) => quote(c.name)).join(", ");
        const pkList = table.primaryKey.map(quote).join(", ");
        const pkTypes = table.primaryKey.map((k) => table.columns.find((c) => c.name === k)!.type);
        for (;;) {
          const after = last
            ? ` WHERE (${pkList}) > (${table.primaryKey.map((_, i) => `$${i + 1}::${pkTypes[i]}`).join(", ")})`
            : "";
          const page = (
            await client.query({
              text: `SELECT ${select} FROM ${quote(table.name)}${after} ORDER BY ${pkList} LIMIT ${PAGE_ROWS}`,
              values: last ?? [],
              rowMode: "array",
            })
          ).rows as (string | null)[][];
          for (const row of page) {
            const line =
              JSON.stringify({ t: table.name, v: row.map((v, i) => encodeValue(table.columns[i], v)) }) + "\n";
            hash.update(line);
            count++;
            yield line;
          }
          if (page.length < PAGE_ROWS) break;
          const tail = page[page.length - 1];
          last = table.primaryKey.map((k) => tail[table.columns.findIndex((c) => c.name === k)]);
        }
        manifest.tables[table.name] = { rows: count, sha256: hash.digest("hex") };
        result.tables.push({ name: table.name, rows: count });
        log(`${table.name}: ${count} row(s)`);
      }
      yield JSON.stringify(manifest) + "\n";
    }

    try {
      await pipeline(Readable.from(lines()), createGzip(), createWriteStream(partial));
      renameSync(partial, file);
    } catch (err) {
      rmSync(partial, { force: true });
      throw err;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------- import

export class InstanceImportRefused extends Error {}

export interface ImportResult {
  schemaVersion: number;
  tables: { name: string; rows: number }[];
}

/** Refuses a target that already holds anything but the stages every new database starts with. */
async function assertTargetEmpty(client: Q, schemaTables: string[]): Promise<void> {
  const occupied: string[] = [];
  for (const table of schemaTables) {
    if (table === "schema_migrations" || table === "environments") continue;
    const found = await rows(client, `SELECT 1 FROM ${quote(table)} LIMIT 1`);
    if (found.length > 0) occupied.push(table);
  }
  const stages = (await rows<{ name: string }>(client, "SELECT name FROM environments ORDER BY name")).map(
    (r) => r.name,
  );
  const untouched =
    stages.length === 0 ||
    (stages.length === SEEDED_ENVIRONMENTS.length && stages.every((n, i) => n === SEEDED_ENVIRONMENTS[i]));
  if (!untouched) occupied.push("environments");
  if (occupied.length > 0) {
    throw new InstanceImportRefused(
      `the database is not empty (${occupied.join(", ")}): an archive is only restored into a new, migrated one`,
    );
  }
}

interface ArchiveReader {
  next(): Promise<string | undefined>;
  /** Throws when the gzip layer failed (truncated or corrupt file). */
  check(): void;
  close(): void;
}

function openArchive(file: string): ArchiveReader {
  const raw = createReadStream(file);
  const input = raw.pipe(createGunzip());
  raw.on("error", (err) => input.destroy(err));
  const lineReader = createInterface({ input, crlfDelay: Infinity });
  const iterator = lineReader[Symbol.asyncIterator]();
  // Errors of the gzip layer do not reach readline: remember them.
  let streamError: Error | undefined;
  input.on("error", (err) => {
    streamError = err;
    lineReader.close();
  });
  const unreadable = (err: unknown) =>
    new InstanceImportRefused(`cannot read the archive: ${err instanceof Error ? err.message : String(err)}`);
  return {
    async next() {
      try {
        const r = await iterator.next();
        return r.done ? undefined : r.value;
      } catch (err) {
        throw unreadable(err);
      }
    },
    check() {
      if (streamError) throw unreadable(streamError);
    },
    close() {
      lineReader.close();
      input.destroy();
      raw.destroy();
    },
  };
}

function parseHeader(first: string | undefined): ArchiveHeader {
  let header: ArchiveHeader;
  try {
    header = JSON.parse(first ?? "") as ArchiveHeader;
  } catch {
    throw new InstanceImportRefused("not a NebulaDB instance archive (no readable header)");
  }
  if (header.type !== "header" || header.format !== ARCHIVE_FORMAT) {
    throw new InstanceImportRefused("not a NebulaDB instance archive (unknown format)");
  }
  if (header.version !== ARCHIVE_VERSION) {
    throw new InstanceImportRefused(`unsupported archive format version ${header.version}`);
  }
  const codeVersion = codeSchemaVersion();
  if (header.schemaVersion > codeVersion) {
    throw new InstanceImportRefused(
      `the archive is at schema version ${header.schemaVersion}, newer than this NebulaDB (${codeVersion}): ` +
        "restore it with the same or a newer release",
    );
  }
  return header;
}

/** The target is migrated, knows every archived table and column, and is empty. */
async function checkTarget(client: Q, header: ArchiveHeader): Promise<void> {
  const codeVersion = codeSchemaVersion();
  const dbVersion = await currentSchemaVersion(client);
  if (dbVersion !== codeVersion) {
    throw new InstanceImportRefused(
      `the database is at schema version ${dbVersion}, this NebulaDB expects ${codeVersion}: start it once so it migrates`,
    );
  }
  const { tables: targetTables, schemaTables } = await discoverTables(client);
  for (const table of header.tables) {
    const target = targetTables.find((t) => t.name === table.name);
    if (!target) throw new InstanceImportRefused(`the database has no table ${table.name}`);
    const missing = table.columns.filter((c) => !target.columns.some((t) => t.name === c.name));
    if (missing.length > 0) {
      throw new InstanceImportRefused(
        `${table.name}: no column ${missing.map((c) => c.name).join(", ")} in the database`,
      );
    }
  }
  await assertTargetEmpty(client, schemaTables);
  // Seeded by the first migration; the archive's own stages replace them.
  if (header.tables.some((t) => t.name === "environments")) await client.query("DELETE FROM environments");
}

type Row = (string | null)[];
type DeferredRef = { table: ArchiveTable; pk: Row; ref: Record<string, string | null> };

async function insertBatch(client: Q, table: ArchiveTable, batch: Row[]): Promise<void> {
  if (batch.length === 0) return;
  const cols = table.columns;
  const overriding = cols.some((c) => c.identityAlways) ? " OVERRIDING SYSTEM VALUE" : "";
  let slot = 0;
  const values = batch.map((row) => `(${row.map((_, i) => `$${++slot}::${cols[i].type}`).join(", ")})`).join(", ");
  await client.query(
    `INSERT INTO ${quote(table.name)} (${cols.map((c) => quote(c.name)).join(", ")})${overriding} VALUES ${values}`,
    batch.flat(),
  );
}

/** Row values as bound parameters; self references are split off (NULL for now, applied by {@link finishTable}). */
function prepareRow(table: ArchiveTable, values: Row, deferred: DeferredRef[]): Row {
  const row = values.map((v, i) =>
    v !== null && table.columns[i].bytea ? "\\x" + Buffer.from(v, "base64").toString("hex") : v,
  );
  if (table.selfRefs.length === 0) return row;
  const ref: Record<string, string | null> = {};
  for (const column of table.selfRefs) {
    const i = table.columns.findIndex((c) => c.name === column);
    if (row[i] !== null) {
      ref[column] = row[i];
      row[i] = null;
    }
  }
  if (Object.keys(ref).length > 0) {
    deferred.push({ table, pk: table.primaryKey.map((k) => row[table.columns.findIndex((c) => c.name === k)]), ref });
  }
  return row;
}

interface LoadedRows {
  manifest: ArchiveManifest | undefined;
  counts: Map<string, number>;
  hashes: Map<string, ReturnType<typeof createHash>>;
}

/** Streams the archive's row lines into the database, table after table. */
async function loadRows(client: Q, reader: ArchiveReader, header: ArchiveHeader): Promise<LoadedRows> {
  const loaded: LoadedRows = { manifest: undefined, counts: new Map(), hashes: new Map() };
  const deferred: DeferredRef[] = [];
  let current = -1;
  let batch: Row[] = [];

  for (let line = await reader.next(); line !== undefined; line = await reader.next()) {
    if (line === "") continue;
    let parsed: { t?: string; v?: Row; type?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new InstanceImportRefused("the archive is corrupt (unreadable line)");
    }
    if (parsed.type === "manifest") {
      loaded.manifest = parsed as unknown as ArchiveManifest;
      continue;
    }
    if (loaded.manifest) throw new InstanceImportRefused("the archive is corrupt (data after the manifest)");
    const index = header.tables.findIndex((t) => t.name === parsed.t);
    if (index === -1 || index < current || !Array.isArray(parsed.v)) {
      throw new InstanceImportRefused(`the archive is corrupt (unexpected row for ${String(parsed.t)})`);
    }
    if (index !== current) {
      await insertBatch(client, header.tables[current], batch);
      batch = [];
      await finishTable(client, header.tables[current], deferred);
      current = index;
    }
    const table = header.tables[current];
    if (parsed.v.length !== table.columns.length) {
      throw new InstanceImportRefused(`the archive is corrupt (${table.name}: wrong column count)`);
    }
    if (!loaded.hashes.has(table.name)) loaded.hashes.set(table.name, createHash("sha256"));
    loaded.hashes.get(table.name)!.update(line + "\n");
    loaded.counts.set(table.name, (loaded.counts.get(table.name) ?? 0) + 1);

    batch.push(prepareRow(table, parsed.v, deferred));
    if (batch.length >= INSERT_ROWS) {
      await insertBatch(client, table, batch);
      batch = [];
    }
  }
  reader.check();
  await insertBatch(client, header.tables[current], batch);
  await finishTable(client, header.tables[current], deferred);
  return loaded;
}

/** Counters continue after the restored rows. */
async function resetSequences(client: Q, table: ArchiveTable): Promise<void> {
  for (const column of table.columns) {
    const seq = (
      await rows<{ s: string | null }>(client, "SELECT pg_get_serial_sequence($1, $2) AS s", [
        quote(table.name),
        column.name,
      ])
    )[0].s;
    if (!seq) continue;
    const col = quote(column.name);
    await client.query(
      `SELECT setval($1, COALESCE(MAX(${col}), 1), MAX(${col}) IS NOT NULL) FROM ${quote(table.name)}`,
      [seq],
    );
  }
}

/** The archive matches its manifest, and every row landed. Resets the counters on the way. */
async function verifyRestore(
  client: Q,
  header: ArchiveHeader,
  loaded: LoadedRows,
  log: (line: string) => void,
): Promise<ImportResult> {
  const { manifest } = loaded;
  if (!manifest) throw new InstanceImportRefused("the archive is truncated (no manifest)");
  const result: ImportResult = { schemaVersion: header.schemaVersion, tables: [] };
  for (const table of header.tables) {
    const expected = manifest.tables[table.name];
    const digest = (loaded.hashes.get(table.name) ?? createHash("sha256")).digest("hex");
    if (!expected || expected.rows !== (loaded.counts.get(table.name) ?? 0) || expected.sha256 !== digest) {
      throw new InstanceImportRefused(`${table.name}: the archive does not match its manifest (corrupt or edited)`);
    }
    const landed = Number((await rows<{ n: string }>(client, `SELECT COUNT(*) AS n FROM ${quote(table.name)}`))[0].n);
    if (landed !== expected.rows) {
      throw new Error(`${table.name}: ${expected.rows} row(s) in the archive, ${landed} in the database`);
    }
    await resetSequences(client, table);
    result.tables.push({ name: table.name, rows: landed });
    log(`${table.name}: ${landed} row(s)`);
  }
  return result;
}

/**
 * Restores `file` into the empty, migrated database `client` is connected to,
 * in one transaction: any problem leaves the database as it was. `client` must
 * be connected and built with {@link rawTypes}.
 */
export async function importInstance(
  client: pg.Client,
  file: string,
  log: (line: string) => void = () => {},
): Promise<ImportResult> {
  const reader = openArchive(file);
  try {
    const header = parseHeader(await reader.next());
    await client.query("BEGIN");
    try {
      await checkTarget(client, header);
      const loaded = await loadRows(client, reader, header);
      const result = await verifyRestore(client, header, loaded, log);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    reader.close();
  }
}

/** Applies the self references collected for `table` (rows are all in). */
async function finishTable(
  client: Q,
  table: ArchiveTable | undefined,
  deferred: { table: ArchiveTable; pk: (string | null)[]; ref: Record<string, string | null> }[],
): Promise<void> {
  if (!table) return;
  const mine = deferred.filter((d) => d.table === table);
  for (const entry of mine) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [column, value] of Object.entries(entry.ref)) {
      const type = table.columns.find((c) => c.name === column)!.type;
      values.push(value);
      sets.push(`${quote(column)} = $${values.length}::${type}`);
    }
    const where = table.primaryKey
      .map((k, i) => {
        values.push(entry.pk[i]);
        return `${quote(k)} = $${values.length}::${table.columns.find((c) => c.name === k)!.type}`;
      })
      .join(" AND ");
    await client.query(`UPDATE ${quote(table.name)} SET ${sets.join(", ")} WHERE ${where}`, values);
  }
  deferred.splice(0, deferred.length, ...deferred.filter((d) => d.table !== table));
}
