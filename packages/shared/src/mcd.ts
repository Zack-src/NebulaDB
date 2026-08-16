import type { Field, Project, Ref, RefEndpoint, Table } from "./schema.js";

/**
 * MCD (Merise conceptual model) derived from the existing MLD (`Table`/
 * `Field`/`Ref`). This is a pure, read-only *projection* — nothing here is
 * persisted or editable. DBML/`Project` stays the single source of truth;
 * `deriveMCD` just reads it through a different lens.
 *
 * The derivation is retro-engineering, and retro-engineering a conceptual
 * model out of a relational one is inherently lossy: it can reconstruct
 * binary associations (including many-to-many via join-table collapse), but
 * it cannot recover the modeler's original intent for ambiguous shapes
 * (ternary associations, a join table that's secretly a real entity, min
 * cardinalities beyond what a foreign key can enforce). Those cases are
 * reported in `warnings` and left as plain entities rather than guessed at.
 */

export type McdCardinality = "0,1" | "1,1" | "0,n" | "1,n";

export interface McdAttribute {
  id: string;
  name: string;
  /** Free-form domain label — taken as-is from the source `Field.type`. */
  domain: string;
}

export interface McdEntity {
  id: string;
  name: string;
  attributes: McdAttribute[];
  /** Id of the `Table` this entity was derived from. */
  sourceTableId: string;
}

export interface McdAssociationMember {
  entityId: string;
  cardinality: McdCardinality;
}

export interface McdAssociation {
  id: string;
  name: string;
  /** Always 2 in this derivation — no ternary+ association is reconstructed (see module docs). Both members reference the same entity for a reflexive association. */
  members: [McdAssociationMember, McdAssociationMember];
  attributes: McdAttribute[];
  /** Id of the `Ref` this came from, or of the join `Table` it was collapsed from. */
  sourceId: string;
}

export type McdWarningReason =
  /** A table looked association-like (its PK is entirely made of FKs) but had more than 2, so a binary association couldn't be reconstructed. */
  | "possible-ternary-association"
  /** A table has 2+ FK fields in its PK but the PK doesn't exactly match the FK set, so the junction-table pattern couldn't be applied cleanly. */
  | "ambiguous-junction-table";

export interface McdWarning {
  tableId: string;
  tableName: string;
  reason: McdWarningReason;
}

export interface McdModel {
  entities: McdEntity[];
  associations: McdAssociation[];
  warnings: McdWarning[];
}

function toAttribute(field: Field): McdAttribute {
  return { id: field.id, name: field.name, domain: field.type };
}

/** A table's full set of PK field ids — a single `pk` flag, or a composite PK index (see `TableIndex.pk`), never both in practice. */
function pkFieldIds(table: Table): Set<string> {
  const ids = new Set<string>();
  for (const field of table.fields) if (field.pk) ids.add(field.id);
  for (const index of table.indexes) if (index.pk) index.fieldIds.forEach((id) => ids.add(id));
  return ids;
}

function isPk(endpoint: RefEndpoint, tablesById: Map<string, Table>): boolean {
  const table = tablesById.get(endpoint.tableId);
  return table ? pkFieldIds(table).has(endpoint.fieldId) : false;
}

/**
 * Which endpoint is the FK ("child") and which is the referenced ("parent")
 * one — determined by which field is actually its table's primary key, not
 * by `from`/`to` order. `Ref.from`/`Ref.to` just mirror DBML declaration
 * order (`A.x > B.y` sets `from: A.x, to: B.y`), and a schema is free to
 * write that either way round — a real FK, however, *must* point at a
 * unique/PK column, so the PK side reliably identifies the parent regardless
 * of how the ref was written. Falls back to the `from`-is-parent convention
 * (matches the MLD canvas's own cardinality-chip convention) only when
 * neither or both sides are a PK and the structural signal is unavailable.
 */
function resolveDirection(ref: Ref, tablesById: Map<string, Table>): { parent: RefEndpoint; child: RefEndpoint } {
  const fromIsPk = isPk(ref.from, tablesById);
  const toIsPk = isPk(ref.to, tablesById);
  if (toIsPk && !fromIsPk) return { parent: ref.to, child: ref.from };
  return { parent: ref.from, child: ref.to };
}

/** Fixed by the relationship shape, not inferred per-row — see module docs on why. */
function parentSideCardinality(cardinality: Ref["cardinality"]): McdCardinality {
  return cardinality === "one-to-one" ? "0,1" : "0,n";
}

/** The FK-holding side's min bound is the one thing a schema *can* tell us: NOT NULL means every row must reference a parent. */
function fkSideCardinality(fkField: Field | undefined): McdCardinality {
  return fkField?.notNull ? "1,1" : "0,1";
}

interface JunctionCandidate {
  table: Table;
  /** The 2 parent endpoints, resolved — not the raw refs — so the collapse always attaches to the actual referenced side. */
  parents: [RefEndpoint, RefEndpoint];
  childFieldIds: Set<string>;
  refIds: [string, string];
}

/**
 * A table collapses into an n,n association when its whole PK is exactly the
 * 2 FK fields of 2 refs pointing at 2 different tables, and it isn't itself
 * the parent side of anything else — the textbook Merise many-to-many join
 * table.
 */
function findJunctionCandidates(
  tables: Table[],
  refs: Ref[],
  tablesById: Map<string, Table>,
): { candidates: JunctionCandidate[]; warnings: McdWarning[] } {
  // Every non-reflexive ref, resolved to its structural {parent, child} —
  // computed once here since both junction detection and the main pass need it.
  const resolved = refs
    .filter((ref) => ref.from.tableId !== ref.to.tableId)
    .map((ref) => ({ ref, ...resolveDirection(ref, tablesById) }));

  const childOfTable = new Map<string, typeof resolved>(); // table id -> refs where it's the child side
  const parentOfTable = new Map<string, typeof resolved>(); // table id -> refs where it's the parent side
  for (const r of resolved) {
    (childOfTable.get(r.child.tableId) ?? childOfTable.set(r.child.tableId, []).get(r.child.tableId)!).push(r);
    (parentOfTable.get(r.parent.tableId) ?? parentOfTable.set(r.parent.tableId, []).get(r.parent.tableId)!).push(r);
  }

  const candidates: JunctionCandidate[] = [];
  const warnings: McdWarning[] = [];

  for (const table of tables) {
    const asChild = childOfTable.get(table.id) ?? [];
    const asParent = parentOfTable.get(table.id) ?? [];
    if (asParent.length > 0) continue; // a real junction table is never itself a parent
    if (asChild.length < 2) continue;

    const pkIds = pkFieldIds(table);
    const fkFieldIds = new Set(asChild.map((r) => r.child.fieldId));
    const overlap = [...pkIds].filter((id) => fkFieldIds.has(id));

    const pkMatchesFkSet = pkIds.size === fkFieldIds.size && overlap.length === pkIds.size;

    if (asChild.length === 2 && pkMatchesFkSet) {
      candidates.push({
        table,
        parents: [asChild[0].parent, asChild[1].parent],
        childFieldIds: fkFieldIds,
        refIds: [asChild[0].ref.id, asChild[1].ref.id],
      });
    } else if (asChild.length > 2 && pkMatchesFkSet) {
      warnings.push({ tableId: table.id, tableName: table.name, reason: "possible-ternary-association" });
    } else if (overlap.length > 0 && !pkMatchesFkSet) {
      // Genuine ambiguity: *some* but not all of the PK is FK fields (or the
      // PK covers them plus something else) — a shape we can't collapse
      // cleanly. A table whose FKs have *no* overlap with its PK at all
      // (e.g. a surrogate-keyed entity with two ordinary FK columns) isn't
      // ambiguous — it's just a plain entity with regular associations,
      // handled by the main pass below with no warning.
      warnings.push({ tableId: table.id, tableName: table.name, reason: "ambiguous-junction-table" });
    }
  }

  return { candidates, warnings };
}

/** Derives an MCD (entities + associations) from the current MLD. Pure and side-effect free — safe to call on every render. */
export function deriveMCD(project: Project): McdModel {
  const tablesById = new Map(project.tables.map((t) => [t.id, t]));
  const fieldById = new Map<string, Field>();
  for (const table of project.tables) for (const field of table.fields) fieldById.set(field.id, field);

  const { candidates, warnings } = findJunctionCandidates(project.tables, project.refs, tablesById);
  const junctionTableIds = new Set(candidates.map((c) => c.table.id));
  const absorbedRefIds = new Set(candidates.flatMap((c) => c.refIds));

  // Child-side (FK) fields, per table — dropped from the entity's attribute
  // list since the association already represents that relationship; MCD
  // entities carry no FK columns. Resolved structurally, same as everywhere
  // else here, not by raw `ref.to`.
  const childFieldIdsByTable = new Map<string, Set<string>>();
  for (const table of project.tables) childFieldIdsByTable.set(table.id, new Set());
  for (const ref of project.refs) {
    if (absorbedRefIds.has(ref.id) || ref.cardinality === "many-to-many") continue;
    const { child } = resolveDirection(ref, tablesById);
    childFieldIdsByTable.get(child.tableId)?.add(child.fieldId);
  }

  const entities: McdEntity[] = project.tables
    .filter((table) => !junctionTableIds.has(table.id))
    .map((table) => {
      const dropped = childFieldIdsByTable.get(table.id) ?? new Set();
      return {
        id: table.id,
        name: table.name,
        sourceTableId: table.id,
        attributes: table.fields.filter((f) => !dropped.has(f.id)).map(toAttribute),
      };
    });

  const associations: McdAssociation[] = [];

  for (const candidate of candidates) {
    const [p1, p2] = candidate.parents;
    associations.push({
      id: `assoc:${candidate.table.id}`,
      name: candidate.table.name,
      sourceId: candidate.table.id,
      members: [
        { entityId: p1.tableId, cardinality: "0,n" },
        { entityId: p2.tableId, cardinality: "0,n" },
      ],
      attributes: candidate.table.fields.filter((f) => !candidate.childFieldIds.has(f.id)).map(toAttribute),
    });
  }

  for (const ref of project.refs) {
    if (absorbedRefIds.has(ref.id)) continue;
    const fromTable = tablesById.get(ref.from.tableId);
    const toTable = tablesById.get(ref.to.tableId);
    if (!fromTable || !toTable) continue;

    const isReflexive = ref.from.tableId === ref.to.tableId;
    const { parent, child } = ref.cardinality === "many-to-many" ? { parent: ref.from, child: ref.to } : resolveDirection(ref, tablesById);

    const parentMember: McdAssociationMember = {
      entityId: parent.tableId,
      cardinality: parentSideCardinality(ref.cardinality),
    };
    const childMember: McdAssociationMember = {
      entityId: child.tableId,
      cardinality: ref.cardinality === "many-to-many" ? "0,n" : fkSideCardinality(fieldById.get(child.fieldId)),
    };

    associations.push({
      id: `assoc:${ref.id}`,
      name: ref.name || (isReflexive ? fromTable.name : `${fromTable.name}_${toTable.name}`),
      sourceId: ref.id,
      members: [parentMember, childMember],
      attributes: [],
    });
  }

  return { entities, associations, warnings };
}
