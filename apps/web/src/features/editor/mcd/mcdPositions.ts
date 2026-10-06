import type { McdModel, Position, Project } from "@nebuladb/shared";

/**
 * Positions the MCD graph from the *existing* MLD layout, so switching views keeps the schema
 * recognizable. An entity keeps its table's position; an association collapsed from a junction
 * table keeps that table's position; one derived from a plain ref goes to the midpoint of its two
 * entities, staggered when several land on the same spot.
 */
export function computeMcdPositions(model: McdModel, project: Project): Map<string, Position> {
  const positions = new Map<string, Position>();
  const tablePositionById = new Map(project.tables.map((t) => [t.id, t.position]));

  for (const entity of model.entities) {
    const pos = tablePositionById.get(entity.sourceTableId);
    if (pos) positions.set(entity.id, pos);
  }

  const midpointCollisions = new Map<string, number>();
  for (const association of model.associations) {
    const sourceTablePos = tablePositionById.get(association.sourceId);
    if (sourceTablePos) {
      positions.set(association.id, sourceTablePos);
      continue;
    }
    const [a, b] = association.members;
    const posA = positions.get(a.entityId);
    const posB = positions.get(b.entityId);
    const base =
      posA && posB ? { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 } : (posA ?? posB ?? { x: 0, y: 0 });

    const key = `${Math.round(base.x / 40)}:${Math.round(base.y / 40)}`;
    const slot = midpointCollisions.get(key) ?? 0;
    midpointCollisions.set(key, slot + 1);
    positions.set(association.id, { x: base.x, y: base.y + slot * 70 });
  }

  return positions;
}
