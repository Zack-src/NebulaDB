import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { McdAssociation, Table } from "@athanordb/shared";
import { DEFAULT_HEADER_COLOR } from "@/features/editor/nodes/table/TableSettingsPopover";
import { prefersDarkText } from "@/utils/color";
import { ROW_TYPE_CLASS, TABLE_NODE_CLASS } from "@/features/editor/nodes/table/tableStyles";

export interface AssociationNodeData {
  association: McdAssociation;
  /** Set when this association was collapsed from a junction table — carries that table's own colour, same as any other table. */
  sourceTable?: Table;
  [key: string]: unknown;
}

export type AssociationNodeType = Node<AssociationNodeData, "association">;

/**
 * MCD association — the Merise diamond, rendered with the same box chrome as
 * `TableNode`/`EntityNode` (rounded-full instead of rounded-sm is the one
 * deliberate difference, to still read as "not an entity" at a glance) and
 * the junction table's own colour when it came from one, rather than an
 * unrelated flat purple that had nothing to do with the rest of the diagram.
 */
function AssociationNodeImpl({ data }: NodeProps<AssociationNodeType>) {
  const { association, sourceTable } = data;
  const headerColor = sourceTable?.style?.color ?? DEFAULT_HEADER_COLOR;

  return (
    <div className={`${TABLE_NODE_CLASS} rounded-full!`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div
        className="flex h-[calc(30px_*_var(--canvas-font-scale))] items-center justify-center px-3 text-[calc(13px_*_var(--canvas-font-scale))] font-semibold italic"
        style={{
          background: headerColor,
          color: prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff",
        }}
      >
        {association.name}
      </div>
      {association.attributes.map((attr) => (
        <div
          key={attr.id}
          className="flex h-[calc(24px_*_var(--canvas-font-scale))] items-center justify-center gap-1.5 whitespace-nowrap border-t border-border px-3"
        >
          <span className="overflow-hidden text-ellipsis text-text-secondary">{attr.name}</span>
          <span className={ROW_TYPE_CLASS}>{attr.domain}</span>
        </div>
      ))}
    </div>
  );
}

export const AssociationNode = memo(AssociationNodeImpl);
