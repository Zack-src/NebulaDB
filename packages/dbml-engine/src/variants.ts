import type { EnumDef, Field, Project, Ref, Table, TableGroup, TableIndex } from "@nebuladb/shared";

// Pure Project → Project, no `@dbml/core` import: safe client-side, like diff.ts.

/**
 * Bringing a client's variant up to date with the project it was copied from.
 *
 * Three versions take part: the original as it was when the variant last
 * received it (`synced`), the original now (`base`), and the variant now
 * (`variant`). What changed between `synced` and `base` is what there is to
 * send; whether the client changed the same thing since is what makes it a
 * conflict. Everything is matched by id, which a variant shares with its
 * original because it started as a copy of it.
 *
 * Only the schema travels: tables (name, schema, note), fields, indexes,
 * relations, enums and table groups. Positions, sizes, styles, zones, sticky
 * notes and comments are each project's own layout and are never sent.
 */

export type VariantChangeKind = "table" | "field" | "index" | "ref" | "enum" | "group";
export type VariantChangeAction = "add" | "update" | "remove";
/** `variant-changed`: the client changed it too since the last sending. `variant-removed`: the client deleted it (or the table holding it). */
export type VariantConflict = "variant-changed" | "variant-removed";

export interface VariantChange {
  /** Stable for one plan: what a decision refers to. */
  key: string;
  kind: VariantChangeKind;
  action: VariantChangeAction;
  /** `orders`, `orders.total`, `orders → customers`… as a person reads it. */
  label: string;
  /** The table this belongs to, for grouping; absent for enums and groups. */
  tableName?: string;
  conflict?: VariantConflict;
}

export interface VariantSyncPlan {
  changes: VariantChange[];
}

/** Per change: `base` takes the original's version, `variant` keeps the client's. Missing: `base` unless it is a conflict. */
export type VariantDecisions = Record<string, "base" | "variant">;

// ---- comparing what matters -------------------------------------------------

/** JSON with sorted keys and without `undefined`, so two equal objects always compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const tableCore = (t: Table) => canonical({ name: t.name, schemaName: t.schemaName, note: t.note });
const fieldCore = (f: Field) => canonical(f);
const indexCore = (i: TableIndex) => canonical(i);
const refCore = (r: Ref) =>
  canonical({
    name: r.name,
    from: r.from,
    to: r.to,
    cardinality: r.cardinality,
    onDelete: r.onDelete,
    onUpdate: r.onUpdate,
  });
const enumCore = (e: EnumDef) => canonical({ name: e.name, values: e.values });
const groupCore = (g: TableGroup) => canonical({ name: g.name, tableIds: g.tableIds, note: g.note });

/** A table's whole schema, layout left out: what "the client did not touch this table" compares. */
const tableSchema = (t: Table) =>
  canonical({ core: tableCore(t), fields: t.fields.map(fieldCore), indexes: t.indexes.map(indexCore) });

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * The three-way rule for one item: what the original did since the last
 * sending, and whether the client is in the way. `null`: nothing to send.
 */
function classify<T>(
  synced: T | undefined,
  base: T | undefined,
  variant: T | undefined,
  core: (item: T) => string,
): { action: VariantChangeAction; conflict?: VariantConflict } | null {
  const s = synced === undefined ? null : core(synced);
  const b = base === undefined ? null : core(base);
  const v = variant === undefined ? null : core(variant);
  if (s === b) return null; // the original did not change it
  if (v === b) return null; // the client already has it as the original now does
  const action: VariantChangeAction = s === null ? "add" : b === null ? "remove" : "update";
  if (v === s) return { action }; // the client never touched it
  if (v === null) return { action, conflict: "variant-removed" };
  return { action, conflict: "variant-changed" };
}

// ---- the plan ---------------------------------------------------------------

function refLabel(ref: Ref, project: Project): string {
  const tables = byId(project.tables);
  const end = (endpoint: Ref["from"]) => {
    const table = tables.get(endpoint.tableId);
    const field = table?.fields.find((f) => f.id === endpoint.fieldId);
    return `${table?.name ?? "?"}.${field?.name ?? "?"}`;
  };
  return `${end(ref.from)} → ${end(ref.to)}`;
}

/** What sending the original's changes to this variant would do — nothing is changed. */
export function planVariantSync(synced: Project, base: Project, variant: Project): VariantSyncPlan {
  const changes: VariantChange[] = [];
  const S = byId(synced.tables);
  const B = byId(base.tables);
  const V = byId(variant.tables);

  for (const id of new Set([...S.keys(), ...B.keys()])) {
    const s = S.get(id);
    const b = B.get(id);
    const v = V.get(id);
    const name = (b ?? s)!.name;
    // A table appearing or disappearing travels whole.
    if (!s || !b) {
      const verdict = classify(s, b, v, tableSchema);
      if (verdict) changes.push({ key: `table:${id}`, kind: "table", label: name, tableName: name, ...verdict });
      continue;
    }
    if (!v) {
      // The client deleted a table the original still changes: one conflict for the whole table.
      if (tableSchema(s) !== tableSchema(b))
        changes.push({
          key: `table:${id}`,
          kind: "table",
          action: "update",
          label: name,
          tableName: name,
          conflict: "variant-removed",
        });
      continue;
    }
    const core = classify(s, b, v, tableCore);
    if (core) changes.push({ key: `table:${id}`, kind: "table", label: name, tableName: name, ...core });

    const sf = byId(s.fields);
    const bf = byId(b.fields);
    const vf = byId(v.fields);
    for (const fieldId of new Set([...sf.keys(), ...bf.keys()])) {
      const verdict = classify(sf.get(fieldId), bf.get(fieldId), vf.get(fieldId), fieldCore);
      const field = (bf.get(fieldId) ?? sf.get(fieldId))!;
      if (verdict)
        changes.push({
          key: `field:${id}:${fieldId}`,
          kind: "field",
          label: `${name}.${field.name}`,
          tableName: name,
          ...verdict,
        });
    }
    const si = byId(s.indexes);
    const bi = byId(b.indexes);
    const vi = byId(v.indexes);
    for (const indexId of new Set([...si.keys(), ...bi.keys()])) {
      const verdict = classify(si.get(indexId), bi.get(indexId), vi.get(indexId), indexCore);
      const index = (bi.get(indexId) ?? si.get(indexId))!;
      const fields = index.fieldIds.map((fid) => (bf.get(fid) ?? sf.get(fid))?.name ?? "?").join(", ");
      if (verdict)
        changes.push({
          key: `index:${id}:${indexId}`,
          kind: "index",
          label: `${name} (${index.name ?? fields})`,
          tableName: name,
          ...verdict,
        });
    }
  }

  const SR = byId(synced.refs);
  const BR = byId(base.refs);
  const VR = byId(variant.refs);
  for (const id of new Set([...SR.keys(), ...BR.keys()])) {
    const verdict = classify(SR.get(id), BR.get(id), VR.get(id), refCore);
    if (!verdict) continue;
    const ref = BR.get(id) ?? SR.get(id)!;
    const owner = BR.get(id) ? base : synced;
    changes.push({
      key: `ref:${id}`,
      kind: "ref",
      label: refLabel(ref, owner),
      tableName: byId(owner.tables).get(ref.from.tableId)?.name,
      ...verdict,
    });
  }

  for (const [kind, pick, core] of [
    ["enum", (p: Project) => p.enums, enumCore],
    ["group", (p: Project) => p.tableGroups, groupCore],
  ] as const) {
    const s = byId<EnumDef | TableGroup>(pick(synced));
    const b = byId<EnumDef | TableGroup>(pick(base));
    const v = byId<EnumDef | TableGroup>(pick(variant));
    for (const id of new Set([...s.keys(), ...b.keys()])) {
      const verdict = classify(s.get(id), b.get(id), v.get(id), core as (item: EnumDef | TableGroup) => string);
      if (verdict) changes.push({ key: `${kind}:${id}`, kind, label: (b.get(id) ?? s.get(id))!.name, ...verdict });
    }
  }
  return { changes };
}

// ---- applying it ------------------------------------------------------------

/** Puts `item` where it stands in `order` (the original's), after the nearest earlier neighbour the list already has. */
function insertInOrder<T extends { id: string }>(list: T[], item: T, order: readonly { id: string }[]): T[] {
  const without = list.filter((x) => x.id !== item.id);
  const position = order.findIndex((x) => x.id === item.id);
  for (let i = position - 1; i >= 0; i--) {
    const at = without.findIndex((x) => x.id === order[i].id);
    if (at >= 0) return [...without.slice(0, at + 1), item, ...without.slice(at + 1)];
  }
  return [item, ...without];
}

function upsert<T extends { id: string }>(list: T[], item: T, order: readonly { id: string }[]): T[] {
  return list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : insertInOrder(list, item, order);
}

/**
 * The variant with the original's changes applied, as `decisions` say. Each
 * change takes the original's version (`base`) — the default — or keeps the
 * client's (`variant`, the default for a conflict). Relations whose ends no
 * longer exist are dropped, as are group members that are gone.
 */
export function applyVariantSync(
  synced: Project,
  base: Project,
  variant: Project,
  decisions: VariantDecisions = {},
): Project {
  const plan = planVariantSync(synced, base, variant);
  const takes = (change: VariantChange) => (decisions[change.key] ?? (change.conflict ? "variant" : "base")) === "base";
  const B = byId(base.tables);
  const S = byId(synced.tables);
  let tables = variant.tables.map((t) => ({ ...t, fields: [...t.fields], indexes: [...t.indexes] }));
  let refs = [...variant.refs];
  let enums = [...variant.enums];
  let tableGroups = [...variant.tableGroups];

  const table = (id: string) => tables.find((t) => t.id === id);
  const replaceTable = (next: Table) => (tables = upsert(tables, next, base.tables));

  for (const change of plan.changes.filter(takes)) {
    const [, first, second] = change.key.split(":");
    switch (change.kind) {
      case "table": {
        const b = B.get(first);
        const v = table(first);
        if (!b) tables = tables.filter((t) => t.id !== first);
        else if (!v) replaceTable(structuredClone(b));
        // New in the original, already there differently: the original's whole table, at the client's place.
        else if (!S.has(first))
          replaceTable({ ...structuredClone(b), position: v.position, size: v.size, style: v.style });
        // Only the table's own properties: its fields and indexes are changes of their own.
        else replaceTable({ ...v, name: b.name, schemaName: b.schemaName, note: b.note });
        break;
      }
      case "field":
      case "index": {
        const b = B.get(first);
        const v = table(first);
        if (!v) break; // the table is gone from the variant: its own conflict says so
        const key = change.kind === "field" ? "fields" : "indexes";
        const fromBase = (b?.[key] as { id: string }[] | undefined)?.find((x) => x.id === second);
        const list = v[key] as { id: string }[];
        const next = fromBase
          ? upsert(list, structuredClone(fromBase), (b?.[key] ?? []) as { id: string }[])
          : list.filter((x) => x.id !== second);
        replaceTable({ ...v, [key]: next } as Table);
        break;
      }
      case "ref": {
        const b = base.refs.find((r) => r.id === first);
        refs = b ? upsert(refs, structuredClone(b), base.refs) : refs.filter((r) => r.id !== first);
        break;
      }
      case "enum": {
        const b = base.enums.find((e) => e.id === first);
        const v = enums.find((e) => e.id === first);
        // A new enum keeps the original's position; an existing one keeps the client's.
        enums = b
          ? upsert(
              enums,
              v ? { ...v, name: b.name, values: structuredClone(b.values) } : structuredClone(b),
              base.enums,
            )
          : enums.filter((e) => e.id !== first);
        break;
      }
      case "group": {
        const b = base.tableGroups.find((g) => g.id === first);
        tableGroups = b
          ? upsert(tableGroups, structuredClone(b), base.tableGroups)
          : tableGroups.filter((g) => g.id !== first);
        break;
      }
    }
  }

  // What no longer holds together: a relation to a field that is gone, an index on one, a group member.
  const fieldsOf = new Map(tables.map((t) => [t.id, new Set(t.fields.map((f) => f.id))]));
  tables = tables.map((t) => {
    const fields = fieldsOf.get(t.id)!;
    const indexes = t.indexes.filter((i) => i.fieldIds.every((id) => fields.has(id)));
    return indexes.length === t.indexes.length ? t : { ...t, indexes };
  });
  const holds = (end: Ref["from"]) => Boolean(fieldsOf.get(end.tableId)?.has(end.fieldId));
  refs = refs.filter((r) => holds(r.from) && holds(r.to));
  tableGroups = tableGroups.map((g) =>
    g.tableIds.every((id) => fieldsOf.has(id)) ? g : { ...g, tableIds: g.tableIds.filter((id) => fieldsOf.has(id)) },
  );

  return { ...variant, tables, refs, enums, tableGroups };
}

/** How far a variant is from its original: what the original has not sent yet, and what the client made its own. */
export function variantStatus(
  synced: Project,
  base: Project,
  variant: Project,
): { pending: number; conflicts: number; customizations: number } {
  const plan = planVariantSync(synced, base, variant);
  // What the client changed since the last sending, seen as the original's changes the other way round.
  const own = planVariantSync(synced, variant, synced).changes.length;
  return {
    pending: plan.changes.length,
    conflicts: plan.changes.filter((c) => c.conflict).length,
    customizations: own,
  };
}

/**
 * `target` with the schema of `source` — the original (a reset) or another
 * variant (a copy). Tables both have keep `target`'s place on the canvas,
 * size and style; tables only `source` has come with their own. Zones and
 * sticky notes are `target`'s, untouched.
 */
export function replaceVariantSchema(target: Project, source: Project): Project {
  const placed = byId(target.tables);
  const placedEnums = byId(target.enums);
  return {
    ...target,
    tables: source.tables.map((table) => {
      const own = placed.get(table.id);
      const copy = structuredClone(table);
      return own
        ? { ...copy, position: own.position, size: own.size, style: own.style, detailLevel: own.detailLevel }
        : copy;
    }),
    refs: source.refs.map((ref) => {
      const own = target.refs.find((r) => r.id === ref.id);
      return own
        ? { ...structuredClone(ref), routingPoints: own.routingPoints, style: own.style }
        : structuredClone(ref);
    }),
    enums: source.enums.map((e) => {
      const own = placedEnums.get(e.id);
      return own ? { ...structuredClone(e), position: own.position } : structuredClone(e);
    }),
    tableGroups: structuredClone(source.tableGroups),
  };
}
