import * as Y from "yjs";
import { getTableGroupsMap, type Table, type TableGroup } from "@athanordb/shared";
import type { TableGroupNodeType } from "@/features/editor/nodes/TableGroupNode";

// A group's box is derived, not stored — position/size come from wherever
// its member tables currently sit, using a generous fixed per-table
// footprint rather than each table's real rendered height (not available
// here: `liveProject` has no measured DOM size, and this runs before React
// Flow has measured anything). Loose enough to rarely clip a real table, not
// pixel-perfect — a visual grouping indicator, not a hard boundary.
const GROUP_MEMBER_WIDTH_ESTIMATE = 240;
const GROUP_MEMBER_HEIGHT_ESTIMATE = 280;
const GROUP_PADDING = 28;
const GROUP_LABEL_MARGIN = 16;

export function buildTableGroupNodes(tableGroups: TableGroup[], tables: Table[], doc: Y.Doc, canWrite = true): TableGroupNodeType[] {
  const tableById = new Map(tables.map((t) => [t.id, t]));
  return tableGroups.map((group) => {
    const members = group.tableIds.map((id) => tableById.get(id)).filter((t): t is Table => Boolean(t));
    const minX = members.length ? Math.min(...members.map((t) => t.position.x)) : 0;
    const minY = members.length ? Math.min(...members.map((t) => t.position.y)) : 0;
    const maxX = members.length
      ? Math.max(...members.map((t) => t.position.x + (t.size?.width ?? GROUP_MEMBER_WIDTH_ESTIMATE)))
      : GROUP_MEMBER_WIDTH_ESTIMATE;
    const maxY = members.length
      ? Math.max(...members.map((t) => t.position.y + (t.size?.height ?? GROUP_MEMBER_HEIGHT_ESTIMATE)))
      : GROUP_MEMBER_HEIGHT_ESTIMATE;

    return {
      id: group.id,
      type: "tablegroup",
      position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_LABEL_MARGIN },
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_MARGIN,
      draggable: false,
      zIndex: -1,
      data: {
        group,
        memberCount: members.length,
        readOnly: !canWrite,
        onRename: (name: string) => {
          const groups = getTableGroupsMap(doc);
          const current = groups.get(group.id);
          if (current) groups.set(group.id, { ...current, name });
        },
        onUngroup: () => {
          getTableGroupsMap(doc).delete(group.id);
        },
      },
    };
  });
}
