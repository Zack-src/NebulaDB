import type { Node } from "@xyflow/react";
import { DEFAULT_HEADER_COLOR } from "@/features/editor/nodes/table/TableSettingsPopover";

/** Fallback for an association node with no source table (a plain-ref-derived one, not collapsed from a junction table) — distinct from the neutral table colour so it still reads as "not an entity" on the minimap too. */
const DEFAULT_ASSOCIATION_COLOR = "#8b5cf6";

/** `<MiniMap nodeColor>` for the MCD canvas — mirrors the node's own header colour (see `EntityNode`/`AssociationNode`). */
export function mcdMinimapNodeColor(node: Node): string {
  const data = node.data as { sourceTable?: { style?: { color?: string } } } | undefined;
  return (
    data?.sourceTable?.style?.color || (node.type === "association" ? DEFAULT_ASSOCIATION_COLOR : DEFAULT_HEADER_COLOR)
  );
}
