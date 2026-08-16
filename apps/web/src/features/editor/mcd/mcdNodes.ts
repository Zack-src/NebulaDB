import type { McdModel, Position, Project, Table } from "@athanordb/shared";
import type { EntityNodeType } from "./EntityNode";
import type { AssociationNodeType } from "./AssociationNode";

export type McdNode = EntityNodeType | AssociationNodeType;

/** Pure assembly of the node array React Flow renders — no state, no positioning logic of its own (see `mcdPositions.ts` for that). */
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
