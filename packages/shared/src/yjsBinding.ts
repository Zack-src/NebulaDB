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

/** Read the doc's current content back into a plain `Project`. */
export function readProjectFromDoc(doc: Y.Doc, fallbackId: string, fallbackName = "Untitled"): Project {
  const meta = getMetaMap(doc);
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
    tables: Array.from(getTablesMap(doc).values()).map((t) => (t.detailLevel ? t : { ...t, detailLevel: "standard" })),
    refs: Array.from(getRefsMap(doc).values()),
    enums: Array.from(getEnumsMap(doc).values()),
    zones: Array.from(getZonesMap(doc).values()),
    stickyNotes: Array.from(getStickyNotesMap(doc).values()),
    tableGroups: Array.from(getTableGroupsMap(doc).values()),
  };
}
