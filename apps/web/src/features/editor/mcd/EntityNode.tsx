import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { McdEntity, Table } from "@athanordb/shared";
import { DEFAULT_HEADER_COLOR } from "@/features/editor/nodes/table/TableSettingsPopover";
import { prefersDarkText } from "@/utils/color";
import {
  ROW_TYPE_CLASS,
  TABLE_HEADER_CLASS,
  TABLE_NAME_CLASS,
  TABLE_NODE_CLASS,
} from "@/features/editor/nodes/table/tableStyles";

export interface EntityNodeData {
  entity: McdEntity;
  /** The table this entity was derived from — read only for its header colour, same as `TableNode`. */
  sourceTable?: Table;
  hasWarning?: boolean;
  [key: string]: unknown;
}

export type EntityNodeType = Node<EntityNodeData, "entity">;

/**
 * MCD entity box — same box chrome as `TableNode` (header colour, borders,
 * row sizing) so switching MLD/MCD reads as "the same schema, different
 * lens" rather than landing in an unrelated-looking canvas. What's
 * intentionally missing is MLD-specific: no PK/FK badges, no detail-level
 * switch, nothing editable — an MCD entity has no notion of a foreign key
 * (that's what the association next to it represents), so its attribute
 * list is already the FK-stripped one `deriveMCD` produced.
 */
function EntityNodeImpl({ data }: NodeProps<EntityNodeType>) {
  const { entity, sourceTable, hasWarning } = data;
  const headerColor = sourceTable?.style?.color ?? DEFAULT_HEADER_COLOR;

  return (
    <div className={`${TABLE_NODE_CLASS} ${hasWarning ? "border-warning" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div
        className={TABLE_HEADER_CLASS}
        style={{
          background: headerColor,
          color: prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff",
        }}
      >
        <span className={TABLE_NAME_CLASS}>{entity.name}</span>
        {hasWarning && (
          <span
            className="ml-auto shrink-0 text-[11px]"
            data-tooltip="Cette table peut cacher une association non reconstruite — voir l'avertissement"
          >
            ⚠
          </span>
        )}
      </div>
      {entity.attributes.map((attr) => (
        <div
          key={attr.id}
          className="flex h-[calc(27px_*_var(--canvas-font-scale))] items-center gap-1.5 whitespace-nowrap border-t border-border px-2.5"
        >
          <span className="overflow-hidden text-ellipsis font-medium text-text">{attr.name}</span>
          <span className={`ml-auto ${ROW_TYPE_CLASS}`}>{attr.domain}</span>
        </div>
      ))}
    </div>
  );
}

export const EntityNode = memo(EntityNodeImpl);
