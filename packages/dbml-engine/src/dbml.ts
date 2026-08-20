import { Parser, ModelExporter } from "@dbml/core";
import { defaultDetailLevelForNewTable, type Position, type Project, type Ref, type Table } from "@athanordb/shared";
import { projectToDbml, refSignature } from "./serialize.js";

export type SqlDialect = "postgres" | "mysql" | "mssql";

const parser = new Parser();

/** Parse DBML source into @dbml/core's raw Database model. */
export function parseDbml(source: string) {
  return parser.parse(source, "dbmlv2");
}

/** Parse SQL DDL of a given dialect into @dbml/core's raw Database model. */
export function parseSql(source: string, dialect: SqlDialect) {
  return parser.parse(source, dialect);
}

/** Export @dbml/core's raw Database model to SQL DDL for a given dialect. */
export function toSql(database: any, dialect: SqlDialect): string {
  return ModelExporter.export(database, dialect, false);
}

export interface DbmlParseErrorInfo {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

interface CompilerDiagnostic {
  message: string;
  location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } };
}

/** @dbml/core's `dbmlv2`/ANTLR parsers throw a `CompilerError` (`{ diags: CompilerDiagnostic[] }`, not a plain `Error` — no `.message` of its own) carrying 1-based line/column per diagnostic. Other failure paths (e.g. semantic validation in `Database`'s constructor) still throw plain `Error`s with no location. This normalizes either into one shape so callers always get a usable message, plus a line/column when the parser can pinpoint one. */
export function describeDbmlParseError(err: unknown): DbmlParseErrorInfo {
  const diags = (err as { diags?: CompilerDiagnostic[] } | null)?.diags;
  if (Array.isArray(diags) && diags.length > 0) {
    const first = diags[0];
    return {
      message: diags.map((d) => d.message).join("; "),
      line: first.location?.start?.line,
      column: first.location?.start?.column,
      endLine: first.location?.end?.line,
      endColumn: first.location?.end?.column,
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

// @dbml/core always creates a schema named "public" when the source doesn't
// declare one (its own DEFAULT_SCHEMA_NAME, hardcoded identically for every
// dialect — including mysql/mssql, which don't even have a "public" schema
// concept). It intends to track whether that name came from the source or
// was defaulted (a `hasDefaultSchema` flag), but the code paths that set it
// are commented out in the installed version, so it's always false and
// useless for that purpose. We recover the distinction ourselves by checking
// the raw source text for a literal "public."-qualified table declaration.
const IMPLICIT_SCHEMA_NAME = "public";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `source` explicitly qualifies `tableName` with `schemaName` (quoted or not, any of DBML/postgres/mysql/mssql's quoting styles). */
function isSchemaExplicitInSource(source: string, schemaName: string, tableName: string): boolean {
  const escSchema = escapeRegExp(schemaName);
  const escTable = escapeRegExp(tableName);
  const ident = (name: string) => `(?:"${name}"|\`${name}\`|\\[${name}\\]|${name})`;
  const pattern = new RegExp(`${ident(escSchema)}\\s*\\.\\s*${ident(escTable)}`, "i");
  return pattern.test(source);
}

/**
 * Convert @dbml/core's raw Database model into AthanorDB's internal Project
 * shape. Visual metadata (position/color/detail level) is not present in
 * DBML/SQL and is defaulted here; the editor fills it in on first layout.
 *
 * `source`, if given, is the raw DBML/SQL text that was parsed — used only
 * to detect whether a table's "public" schema was actually typed by the
 * user (kept) or is just @dbml/core's silent default (dropped), so a schema
 * never round-trips into text that never asked for it. Without `source`
 * (e.g. tests constructing a `Project` directly from a parsed model), a
 * table's schema is treated as implicit whenever it's the default name.
 */
export function toProject(database: any, projectName = "Untitled", source?: string): Project {
  const schema = database.schemas?.[0];
  const tables = (schema?.tables ?? []).map((table: any, index: number) => {
    const fields = (table.fields ?? []).map((field: any) => ({
      id: String(field.id ?? `${table.name}.${field.name}`),
      name: field.name,
      type: field.type?.type_name ?? String(field.type),
      pk: field.pk ?? false,
      unique: field.unique ?? false,
      notNull: field.not_null ?? false,
      increment: field.increment ?? false,
      // @dbml/core gives numeric defaults back as a JS number (e.g. `0`), not
      // a string, even though `Field.default` is typed `string` — coerce so
      // callers (e.g. `formatDefault` when re-serializing to DBML) get what
      // the type promises.
      default: field.dbdefault?.value !== undefined ? String(field.dbdefault.value) : undefined,
      note: field.note ?? undefined,
    }));
    // Index columns carry the column *name* (`column.value`), not a field
    // id — resolve through the fields we just built above so `fieldIds`
    // actually matches `field.id` (same bug class as the ref-endpoint fix
    // below: without this, projectToDbml's field lookup silently drops the
    // whole index). Falls back to the raw value for expression indexes
    // (e.g. `(lower(email))`), which have no corresponding field id.
    const fieldIdByName = new Map(fields.map((f: { id: string; name: string }) => [f.name, f.id]));
    const indexes = (table.indexes ?? []).map((idx: any) => ({
      id: String(idx.id ?? `${table.name}.idx`),
      fieldIds: (idx.columns ?? []).map((c: any) => fieldIdByName.get(c.value) ?? String(c.value ?? c)),
      unique: idx.unique ?? false,
      // @dbml/core normalizes a 2+ column `[pk]` into a composite index and
      // clears each field's own `pk` (see toProject's `fields` map above) —
      // without carrying this flag through, a composite primary key silently
      // becomes a plain, unmarked index and disappears from the UI entirely.
      pk: idx.pk ?? false,
      name: idx.name ?? undefined,
    }));

    const isExplicitSchema =
      schema?.name && schema.name !== IMPLICIT_SCHEMA_NAME
        ? true
        : Boolean(schema?.name && source && isSchemaExplicitInSource(source, schema.name, table.name));

    return {
      id: String(table.id ?? table.name),
      name: table.name,
      schemaName: isExplicitSchema ? schema.name : undefined,
      note: table.note ?? undefined,
      fields,
      indexes,
      position: { x: (index % 6) * 320, y: Math.floor(index / 6) * 400 },
      detailLevel: "standard" as const,
    };
  });

  const refs = (schema?.refs ?? []).map((ref: any, i: number) => {
    const [from, to] = ref.endpoints;
    // @dbml/core endpoints carry tableName/fieldNames, not the numeric ids
    // `toProject` assigns to tables/fields above — resolve through the
    // endpoint's actual Field object (`endpoint.fields[0].table.id`/`.id`)
    // instead, so refs point at the same ids the tables/fields use.
    const fromField = from.fields?.[0];
    const toField = to.fields?.[0];
    return {
      id: String(ref.id ?? `ref-${i}`),
      name: ref.name ?? undefined,
      from: {
        tableId: String(fromField?.table?.id ?? from.tableId ?? from.tableName),
        fieldId: String(fromField?.id ?? from.fieldId ?? from.fieldNames?.[0]),
      },
      to: {
        tableId: String(toField?.table?.id ?? to.tableId ?? to.tableName),
        fieldId: String(toField?.id ?? to.fieldId ?? to.fieldNames?.[0]),
      },
      cardinality: mapCardinality(ref.endpoints),
    };
  });

  // DBML has no notion of enum position (same as zones/sticky notes) — lay
  // fresh imports out in their own grid band below every table's, so a
  // first import doesn't stack every enum node on top of table id `0,0`.
  const enumGridStartRow = Math.ceil(tables.length / 6) + 1;
  const enums = (schema?.enums ?? []).map((e: any, i: number) => ({
    id: String(e.id ?? e.name),
    name: e.name,
    values: (e.values ?? []).map((v: any, vi: number) => ({
      id: String(v.id ?? `${e.name}-${vi}`),
      name: v.name,
      note: v.note ?? undefined,
    })),
    position: { x: (i % 6) * 320, y: (enumGridStartRow + Math.floor(i / 6)) * 400 },
  }));

  // @dbml/core's own table-group tables carry the same declaration-order
  // `.id` the `tables` map above already keyed the AthanorDB `Table.id` on
  // (`String(table.id ?? table.name)`) — resolving through that instead of
  // re-deriving it keeps a group's member ids consistent with the tables array.
  const tableGroups = (schema?.tableGroups ?? []).map((g: any) => ({
    id: String(g.id ?? g.name),
    name: g.name,
    tableIds: (g.tables ?? []).map((t: any) => String(t.id ?? t.name)),
    note: g.note || undefined,
  }));

  return {
    id: crypto.randomUUID(),
    name: projectName,
    tables,
    refs,
    enums,
    zones: [],
    stickyNotes: [],
    tableGroups,
  };
}

function mapCardinality(endpoints: any[]): "one-to-one" | "one-to-many" | "many-to-many" {
  const relations = endpoints.map((e) => e.relation);
  if (relations[0] === "1" && relations[1] === "1") return "one-to-one";
  if (relations[0] === "*" && relations[1] === "*") return "many-to-many";
  return "one-to-many";
}

/** Convert internal `Project` directly to SQL DDL for a dialect, via DBML as the intermediate representation. */
export function projectToSql(project: Project, dialect: SqlDialect): string {
  const dbml = projectToDbml(project);
  const database = parseDbml(dbml);
  return toSql(database, dialect);
}

/**
 * Reconciles a freshly-parsed `incoming` project (from `toProject`, whose ids
 * are just @dbml/core's parse-order assignments, optionally already overlaid
 * with sidecar visual metadata via `applyVisualMetadata`) into `existing`,
 * matching tables/fields by *name* so ids survive a reimport instead of
 * resetting every time. `existing`'s own position/size/style/detail-level/
 * comments win when a table already has them; `incoming`'s (grid-default, or
 * sidecar-restored if the source carried one; comments are DBML-native never,
 * so always `undefined` on `incoming`) only fill in for genuinely new tables.
 * Same idea for zones/sticky notes, which have no per-table anchor to match
 * by: `existing`'s take priority, `incoming`'s (sidecar-only, never
 * DBML-native) only seed a project that doesn't have any yet. Enums are
 * matched by name like tables (a field's `type` names an enum by string,
 * never by id, so there's no cross-reference to remap) and keep the same
 * existing-position-wins/reserve-a-free-slot treatment. Refs are matched by
 * `refSignature` (their endpoint table/field names — a ref's `id` is never
 * DBML-native): a match keeps `existing`'s id/style/routingPoints, same
 * existing-wins pattern as everything else here; a genuinely new ref is
 * taken wholesale from `incoming`.
 */
const GRID_COL_WIDTH = 320;
const GRID_ROW_HEIGHT = 400;
const positionKey = (p: Position) => `${Math.round(p.x)},${Math.round(p.y)}`;

export function mergeProjectIntoExisting(existing: Project, incoming: Project): Project {
  // Case-insensitive: a plain-casing edit (Ctrl+K+U/L uppercasing/lowercasing
  // the DBML text) must still match its old table/field so position, style,
  // size, comments etc. carry over — same identity convention `tableByName`
  // and the migration/diff helpers already use elsewhere (name.toLowerCase()).
  const existingTablesByName = new Map(existing.tables.map((t) => [t.name.toLowerCase(), t]));
  const tableIdRemap = new Map<string, string>();
  const fieldIdRemap = new Map<string, string>();

  // A table whose name changed (typed by hand, Ctrl+H replace, or F2 rename —
  // all three land here as plain text) doesn't match anything in
  // `existingTablesByName` by construction, so without this it looks
  // identical to "the old table got deleted and an unrelated new one got
  // created": fresh id, default grid position, default style/color. Recover
  // the identity for the common case — one table's name changed and nothing
  // else lines up — by pairing the tables left over on each side once field
  // names are set aside. Ambiguous cases (several unmatched tables with
  // similar fields) are left alone rather than guessed at.
  const matchedIncomingNames = new Set(incoming.tables.map((t) => t.name.toLowerCase()));
  const unmatchedExisting = existing.tables.filter((t) => !matchedIncomingNames.has(t.name.toLowerCase()));
  const unmatchedIncoming = incoming.tables.filter((t) => !existingTablesByName.has(t.name.toLowerCase()));
  const renamedFrom = new Map<string, Table>(); // incoming table id -> its likely previous identity
  if (unmatchedExisting.length > 0 && unmatchedIncoming.length > 0) {
    const fieldNames = (t: Table) => new Set(t.fields.map((f) => f.name.toLowerCase()));
    const candidates: { score: number; existing: Table; incoming: Table }[] = [];
    for (const inc of unmatchedIncoming) {
      const incFields = fieldNames(inc);
      for (const ex of unmatchedExisting) {
        const exFields = fieldNames(ex);
        const shared = [...incFields].filter((f) => exFields.has(f)).length;
        const union = new Set([...incFields, ...exFields]).size;
        if (shared === 0 || union === 0) continue;
        const score = shared / union;
        // Require most of the field set to survive the rename, not just a
        // couple of coincidentally-named columns (`id`, `created_at`, ...).
        if (score >= 0.6) candidates.push({ score, existing: ex, incoming: inc });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const claimedExisting = new Set<string>();
    const claimedIncoming = new Set<string>();
    for (const candidate of candidates) {
      if (claimedExisting.has(candidate.existing.id) || claimedIncoming.has(candidate.incoming.id)) continue;
      claimedExisting.add(candidate.existing.id);
      claimedIncoming.add(candidate.incoming.id);
      renamedFrom.set(candidate.incoming.id, candidate.existing);
    }
  }

  // Grid slot for a genuinely new table, skipping whatever's already occupied
  // by an existing table's saved position — otherwise a new table dropped
  // between two others reuses the same declaration-order index one of those
  // already-placed tables was originally given, and lands stacked exactly on
  // top of it instead of appearing where the user can see it.
  const occupiedSlots = new Set(existing.tables.map((t) => positionKey(t.position)));
  let nextSlot = 0;
  const pickFreePosition = (): Position => {
    let pos = { x: (nextSlot % 6) * GRID_COL_WIDTH, y: Math.floor(nextSlot / 6) * GRID_ROW_HEIGHT };
    while (occupiedSlots.has(positionKey(pos))) {
      nextSlot++;
      pos = { x: (nextSlot % 6) * GRID_COL_WIDTH, y: Math.floor(nextSlot / 6) * GRID_ROW_HEIGHT };
    }
    occupiedSlots.add(positionKey(pos));
    nextSlot++;
    return pos;
  };
  // A new table's incoming position is either a sidecar-restored one
  // (legitimate, keep it) or `toProject`'s declaration-order grid default
  // (only free of collisions by coincidence) — try it as-is first, and only
  // fall back to hunting for a free slot if it's actually taken.
  const reservePosition = (candidate: Position): Position => {
    if (!occupiedSlots.has(positionKey(candidate))) {
      occupiedSlots.add(positionKey(candidate));
      return candidate;
    }
    return pickFreePosition();
  };

  const tables: Table[] = incoming.tables.map((table) => {
    const prev = existingTablesByName.get(table.name.toLowerCase()) ?? renamedFrom.get(table.id);
    // @dbml/core's `table.id` is just this parse's declaration-order position
    // (1, 2, 3...), not a stable identity — reusing it for a genuinely new
    // table risks colliding with an unrelated existing table's already-
    // assigned stable id the moment a table gets inserted before others (every
    // later table's positional number shifts by one). A fresh random id has
    // no such collision.
    const finalId = prev?.id ?? crypto.randomUUID();
    tableIdRemap.set(table.id, finalId);

    const prevFieldsByName = new Map((prev?.fields ?? []).map((f) => [f.name.toLowerCase(), f]));
    const fields = table.fields.map((field) => {
      // Same reasoning as `finalId` above, one level down: @dbml/core's
      // `field.id` is also just a positional counter, not a stable identity.
      // Matched case-insensitively too, so uppercasing/lowercasing selected
      // DBML text keeps each field's id (and anything keyed off it).
      const finalFieldId = prevFieldsByName.get(field.name.toLowerCase())?.id ?? crypto.randomUUID();
      fieldIdRemap.set(field.id, finalFieldId);
      return { ...field, id: finalFieldId };
    });
    const indexes = table.indexes.map((idx) => ({
      ...idx,
      fieldIds: idx.fieldIds.map((fid) => fieldIdRemap.get(fid) ?? fid),
    }));

    return {
      ...table,
      id: finalId,
      fields,
      indexes,
      position: prev?.position ?? reservePosition(table.position),
      size: prev?.size ?? table.size,
      style: prev?.style ?? table.style,
      // A genuinely new table (`prev` undefined — declared straight in the
      // DBML buffer) has no detail level of its own to inherit; `toProject`
      // always stamps it "standard", which breaks the project's uniform
      // level the instant it's set to "compact"/"full". Match the rest of
      // the project instead, same as the canvas toolbar's add-table.
      detailLevel: prev?.detailLevel ?? defaultDetailLevelForNewTable(existing.tables),
      // Comments have no DBML equivalent (like zones/sticky notes) — without
      // this, every DBML-driven resync (which happens on nearly every canvas
      // edit, via the live auto-sync loop) would silently wipe them, since
      // `toProject` never populates this field at all.
      comments: prev?.comments ?? table.comments,
    };
  });

  const existingRefsBySignature = new Map<string, Ref>();
  for (const r of existing.refs) {
    const key = refSignature(existing.tables, r);
    if (key) existingRefsBySignature.set(key, r);
  }

  const refs: Ref[] = incoming.refs.map((ref) => {
    const remapped = {
      ...ref,
      from: {
        tableId: tableIdRemap.get(ref.from.tableId) ?? ref.from.tableId,
        fieldId: fieldIdRemap.get(ref.from.fieldId) ?? ref.from.fieldId,
      },
      to: {
        tableId: tableIdRemap.get(ref.to.tableId) ?? ref.to.tableId,
        fieldId: fieldIdRemap.get(ref.to.fieldId) ?? ref.to.fieldId,
      },
    };
    // `tables` (not `existing.tables`) — a previously-existing table's id was
    // preserved above, so this resolves to the same names `existingRefsBySignature` used.
    const key = refSignature(tables, remapped);
    const prev = key ? existingRefsBySignature.get(key) : undefined;
    if (!prev) return remapped;
    return {
      ...remapped,
      id: prev.id,
      style: prev.style ?? remapped.style,
      routingPoints: prev.routingPoints ?? remapped.routingPoints,
    };
  });

  // Enums round-trip the same way tables do now that they carry a canvas
  // position: matched by name (no cross-references to remap — a field's
  // `type` names an enum by string, never by id) so an existing node keeps
  // its id/position/value-ids across a resync, and only a genuinely new
  // enum gets a fresh id and a free grid slot.
  const existingEnumsByName = new Map(existing.enums.map((e) => [e.name, e]));
  const enums = incoming.enums.map((enumDef) => {
    const prev = existingEnumsByName.get(enumDef.name);
    const prevValuesByName = new Map((prev?.values ?? []).map((v) => [v.name, v]));
    return {
      ...enumDef,
      id: prev?.id ?? crypto.randomUUID(),
      values: enumDef.values.map((v) => ({ ...v, id: prevValuesByName.get(v.name)?.id ?? crypto.randomUUID() })),
      position: prev?.position ?? reservePosition(enumDef.position),
    };
  });

  // Same name-matched treatment as enums, one step simpler: a group's only
  // content is its member table ids, which just need remapping through the
  // same `tableIdRemap` built for `tables` above (a table referenced by a
  // group that no longer exists — renamed out from under it or deleted — is
  // dropped from the membership rather than left dangling).
  const existingGroupsByName = new Map(existing.tableGroups.map((g) => [g.name, g]));
  const tableGroups = incoming.tableGroups.map((group) => {
    const prev = existingGroupsByName.get(group.name);
    return {
      ...group,
      id: prev?.id ?? crypto.randomUUID(),
      tableIds: group.tableIds.map((tid) => tableIdRemap.get(tid)).filter((tid): tid is string => Boolean(tid)),
      note: group.note ?? prev?.note,
    };
  });

  return {
    id: existing.id,
    name: existing.name,
    tables,
    refs,
    enums,
    zones: existing.zones.length > 0 ? existing.zones : incoming.zones,
    stickyNotes: existing.stickyNotes.length > 0 ? existing.stickyNotes : incoming.stickyNotes,
    tableGroups,
    paletteColors: existing.paletteColors ?? incoming.paletteColors,
  };
}
