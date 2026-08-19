import * as Y from "yjs";
import type { EnumDef, Id, Project, Ref, StickyNote, Table, TableGroup, Zone } from "./schema.js";

/**
 * Bridges the plain-object `Project` shape to a Y.Doc so the server and web
 * client share one definition of "what a project looks like inside Yjs".
 * Each collection is a top-level Y.Map keyed by entity id; entity values are
 * stored as plain JSON (opaque to Yjs) — merge granularity is per-entity, not
 * per-field, until Phase 5/6 needs finer-grained collaborative editing.
 */
export const META_KEY = "meta";
/**
 * `getTablesMap`'s keys are a `Y.Map`, whose iteration order is fixed the
 * first time each key is ever set and never moves on a later `.set()` of the
 * same key (verified against Yjs directly, not assumed) — so re-declaring an
 * existing table earlier in the DBML buffer updates its *content* in place
 * but never its position in `readProjectFromDoc`'s output. Without this, that
 * reordering looks like it took, right up until the next real schema edit
 * forces a full-buffer resync, which replays the frozen original order over
 * everything and silently undoes it. This meta entry is the desired table
 * order as of the last write, read back to reorder `getTablesMap`'s contents.
 */
export const TABLE_ORDER_KEY = "tableOrder";
export const TABLES_KEY = "tables";
export const REFS_KEY = "refs";
export const ENUMS_KEY = "enums";
export const ZONES_KEY = "zones";
export const STICKY_NOTES_KEY = "stickyNotes";
export const TABLE_GROUPS_KEY = "tableGroups";

export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

export function getTablesMap(doc: Y.Doc): Y.Map<Table> {
  return doc.getMap(TABLES_KEY);
}

export function getRefsMap(doc: Y.Doc): Y.Map<Ref> {
  return doc.getMap(REFS_KEY);
}

export function getEnumsMap(doc: Y.Doc): Y.Map<EnumDef> {
  return doc.getMap(ENUMS_KEY);
}

export function getZonesMap(doc: Y.Doc): Y.Map<Zone> {
  return doc.getMap(ZONES_KEY);
}

export function getStickyNotesMap(doc: Y.Doc): Y.Map<StickyNote> {
  return doc.getMap(STICKY_NOTES_KEY);
}

export function getTableGroupsMap(doc: Y.Doc): Y.Map<TableGroup> {
  return doc.getMap(TABLE_GROUPS_KEY);
}

// Yjs never dedupes a `.set()`/`.delete()` by value equality — it always
// records a new op, fires the doc's "update" event and (per `room.ts`)
// appends a revision row, even when the value written is identical to what
// was already there. `writeProjectToDoc` is called wholesale on every DBML
// panel auto-sync (every ~600ms pause while editing, whether or not anything
// actually changed) plus every revision/snapshot restore, so without this
// check the revision log fills up with no-op entries. Values here are plain
// JSON (opaque to Yjs, per the module doc comment above), and both sides
// come from the same object-literal construction sites, so key order is
// stable and a JSON.stringify comparison is a safe, dependency-free
// stand-in for deep equality.
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setIfChanged<T>(map: Y.Map<T>, key: string, value: T): void {
  if (!jsonEqual(map.get(key), value)) map.set(key, value);
}

function replaceMapContents<T>(map: Y.Map<T>, entries: [Id, T][]): void {
  const nextIds = new Set(entries.map(([id]) => id));
  for (const key of Array.from(map.keys())) {
    if (!nextIds.has(key)) map.delete(key);
  }
  for (const [id, value] of entries) {
    setIfChanged(map, id, value);
  }
}

/** Overwrite the doc's project content in a single transaction. */
export function writeProjectToDoc(doc: Y.Doc, project: Project): void {
  doc.transact(() => {
    const meta = getMetaMap(doc);
    setIfChanged(meta, "id", project.id);
    setIfChanged(meta, "name", project.name);
    if (project.paletteColors) setIfChanged(meta, "paletteColors", project.paletteColors);

    replaceMapContents(
      getTablesMap(doc),
      project.tables.map((t) => [t.id, t]),
    );
    setIfChanged(
      meta,
      TABLE_ORDER_KEY,
      project.tables.map((t) => t.id),
    );
    replaceMapContents(
      getRefsMap(doc),
      project.refs.map((r) => [r.id, r]),
    );
    replaceMapContents(
      getEnumsMap(doc),
      project.enums.map((e) => [e.id, e]),
    );
    replaceMapContents(
      getZonesMap(doc),
      project.zones.map((z) => [z.id, z]),
    );
    replaceMapContents(
      getStickyNotesMap(doc),
      project.stickyNotes.map((s) => [s.id, s]),
    );
    replaceMapContents(
      getTableGroupsMap(doc),
      project.tableGroups.map((g) => [g.id, g]),
    );
  });
}

/**
 * Reorders `Y.Map`-sourced tables to match a stored id order, appending any
 * table not named in it (a legacy doc predating `TABLE_ORDER_KEY`, or one
 * concurrently added by a peer whose write hasn't set it yet) in the map's
 * own — otherwise frozen — iteration order, so nothing is ever dropped.
 */
function orderTables(tables: Table[], order: string[] | undefined): Table[] {
  if (!order || order.length === 0) return tables;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const ordered: Table[] = [];
  for (const id of order) {
    const table = byId.get(id);
    if (table) {
      ordered.push(table);
      byId.delete(id);
    }
  }
  ordered.push(...byId.values());
  return ordered;
}

/** Read the doc's current content back into a plain `Project`. */
export function readProjectFromDoc(doc: Y.Doc, fallbackId: string, fallbackName = "Untitled"): Project {
  const meta = getMetaMap(doc);
  const tables: Table[] = Array.from(getTablesMap(doc).values()).map((t) =>
    t.detailLevel ? t : { ...t, detailLevel: "standard" as const },
  );
  return {
    id: (meta.get("id") as string | undefined) ?? fallbackId,
    name: (meta.get("name") as string | undefined) ?? fallbackName,
    paletteColors: meta.get("paletteColors") as string[] | undefined,
    // Legacy tables predate the `detailLevel` field (added after this doc
    // shape shipped) and have it `undefined` in the Yjs map. Left as-is, one
    // stray legacy table makes every "every table shares a level" check
    // (e.g. the toolbar's active-level highlight) go null the moment a
    // freshly-added table (which does set "standard") is compared against
    // it — surfacing as a bogus "Détail" placeholder state in the UI.
    tables: orderTables(tables, meta.get(TABLE_ORDER_KEY) as string[] | undefined),
    refs: Array.from(getRefsMap(doc).values()),
    enums: Array.from(getEnumsMap(doc).values()),
    zones: Array.from(getZonesMap(doc).values()),
    stickyNotes: Array.from(getStickyNotesMap(doc).values()),
    tableGroups: Array.from(getTableGroupsMap(doc).values()),
  };
}
