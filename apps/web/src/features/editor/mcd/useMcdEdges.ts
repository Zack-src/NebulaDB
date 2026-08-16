import { useMemo } from "react";
import type { McdModel } from "@athanordb/shared";
import type { McdEdgeType } from "./McdEdge";

/** Builds one edge per association member — two legs for a binary association, one for a reflexive one (both members share an entity, so the second leg would just double-draw the first). */
export function useMcdEdges(model: McdModel): McdEdgeType[] {
  return useMemo(
    () =>
      model.associations.flatMap((association) => {
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
      }),
    [model],
  );
}
