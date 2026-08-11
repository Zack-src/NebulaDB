import dagre from "@dagrejs/dagre";
import type { Position, Ref, Table } from "@athanordb/shared";

const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const NODE_WIDTH = 200;

/** Mirrors TableNode's own row-visibility logic, so dagre sizes nodes close to their actual rendered height. */
function visibleRowCount(table: Table, refFieldIds: Set<string>): number {
  if (table.detailLevel === "compact") return 0;
  if (table.detailLevel === "full") return table.fields.length;
  return table.fields.filter((f) => f.pk || refFieldIds.has(f.id)).length;
}

/** Lays out tables left-to-right by ref direction via dagre, sized to roughly match their rendered height. */
export function computeAutoLayout(tables: Table[], refs: Ref[]): Map<string, Position> {
  const refFieldIdsByTable = new Map<string, Set<string>>();
  for (const table of tables) refFieldIdsByTable.set(table.id, new Set());
  for (const ref of refs) {
    refFieldIdsByTable.get(ref.from.tableId)?.add(ref.from.fieldId);
    refFieldIdsByTable.get(ref.to.tableId)?.add(ref.to.fieldId);
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { width: number; height: number }>();
  for (const table of tables) {
    const height = HEADER_HEIGHT + visibleRowCount(table, refFieldIdsByTable.get(table.id) ?? new Set()) * ROW_HEIGHT;
    sizes.set(table.id, { width: NODE_WIDTH, height });
    graph.setNode(table.id, { width: NODE_WIDTH, height });
  }
  for (const ref of refs) {
    if (ref.from.tableId === ref.to.tableId) continue; // dagre can't usefully lay out a self-loop
    if (!sizes.has(ref.from.tableId) || !sizes.has(ref.to.tableId)) continue;
    graph.setEdge(ref.from.tableId, ref.to.tableId);
  }

  dagre.layout(graph);

  const positions = new Map<string, Position>();
  for (const table of tables) {
    const node = graph.node(table.id);
    const size = sizes.get(table.id);
    if (!node || !size) continue;
    positions.set(table.id, { x: node.x - size.width / 2, y: node.y - size.height / 2 });
  }
  return positions;
}
