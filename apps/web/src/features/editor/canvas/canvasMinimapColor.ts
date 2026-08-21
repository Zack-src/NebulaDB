import type { Node } from "@xyflow/react";
import { DEFAULT_HEADER_COLOR } from "@/features/editor/nodes/table/TableSettingsPopover";

const ZONE_DEFAULT_COLOR = "#f59e0b";
const STICKY_NOTE_DEFAULT_COLOR = "#fef08a";
const ENUM_COLOR = "#06b6d4";
const TABLE_GROUP_COLOR = "#a855f7";

/** `<MiniMap nodeColor>` for the main MLD canvas — one node type per shape, mirroring each node's own header/fill colour. Sibling to `mcdMinimapColor.ts`. */
export function canvasMinimapNodeColor(node: Node): string {
  switch (node.type) {
    case "table": {
      const data = node.data as { table?: { style?: { color?: string } } } | undefined;
      return data?.table?.style?.color || DEFAULT_HEADER_COLOR;
    }
    case "zone": {
      const data = node.data as { zone?: { style?: { color?: string } } } | undefined;
      return data?.zone?.style?.color || ZONE_DEFAULT_COLOR;
    }
    case "sticky": {
      const data = node.data as { note?: { style?: { color?: string } } } | undefined;
      return data?.note?.style?.color || STICKY_NOTE_DEFAULT_COLOR;
    }
    case "enum":
      return ENUM_COLOR;
    case "tablegroup":
      return TABLE_GROUP_COLOR;
    default:
      return "var(--color-primary)";
  }
}
