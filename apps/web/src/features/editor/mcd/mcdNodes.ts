import type { Edge, Node } from "@xyflow/svelte";
import type { McdAssociation, McdCardinality, McdEntity, McdModel, Position, Project, Table } from "@athanordb/shared";

export interface EntityNodeData {
  entity: McdEntity;
  /** The table this entity was derived from — read only for its header colour, same as `TableNode`. */
  sourceTable?: Table;
  hasWarning?: boolean;
  [key: string]: unknown;
}

export type EntityNodeType = Node<EntityNodeData, "entity">;

export interface AssociationNodeData {
  association: McdAssociation;
  /** Set when this association was collapsed from a junction table — carries that table's own colour, same as any other table. */
  sourceTable?: Table;
  [key: string]: unknown;
}

export type AssociationNodeType = Node<AssociationNodeData, "association">;

export interface McdEdgeData {
  /** The Merise `min,max` pair for this leg — shown as a chip at the midpoint of the line. */
  cardinality: McdCardinality;
  [key: string]: unknown;
}

export type McdEdgeType = Edge<McdEdgeData, "mcd">;

export type McdNode = EntityNodeType | AssociationNodeType;

/** Pure assembly of the node array the MCD flow renders — no state, no positioning logic of its own (see `mcdPositions.ts` for that). */
export function buildMcdNodes(model: McdModel, project: Project, positions: Map<string, Position>): McdNode[] {
  const tablesById = new Map<string, Table>(project.tables.map((t) => [t.id, t]));
  const warnedTableIds = new Set(model.warnings.map((w) => w.tableId));

  const entityNodes: EntityNodeType[] = model.entities.map((entity) => ({
    id: entity.id,
    type: "entity",
    position: positions.get(entity.id) ?? { x: 0, y: 0 },
    data: {
      entity,
      sourceTable: tablesById.get(entity.sourceTableId),
      hasWarning: warnedTableIds.has(entity.sourceTableId),
    },
  }));
  const associationNodes: AssociationNodeType[] = model.associations.map((association) => ({
    id: association.id,
    type: "association",
    position: positions.get(association.id) ?? { x: 0, y: 0 },
    data: { association, sourceTable: tablesById.get(association.sourceId) },
  }));

  return [...entityNodes, ...associationNodes];
}

/** One edge per association member — two legs for a binary association, one for a reflexive one (both members share an entity, so the second leg would just double-draw the first). */
export function buildMcdEdges(model: McdModel): McdEdgeType[] {
  return model.associations.flatMap((association) => {
    const [a, b] = association.members;
    const legs: McdEdgeType[] = [
      {
        id: `${association.id}:0`,
        source: a.entityId,
        target: association.id,
        type: "mcd",
        data: { cardinality: a.cardinality },
      },
    ];
    if (b.entityId !== a.entityId) {
      legs.push({
        id: `${association.id}:1`,
        source: association.id,
        target: b.entityId,
        type: "mcd",
        data: { cardinality: b.cardinality },
      });
    }
    return legs;
  });
}
