import dagre from "@dagrejs/dagre";
import type { Position, Ref, Size, Table, TableGroup, Zone } from "@athanordb/shared";

const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const NODE_WIDTH = 200;
// Extra room dagre's own node/rank separation doesn't provide: the visible
// margin between a cluster's outer edge and its neighbours, and how far a
// zone's redrawn rectangle sits outside its member tables' bounding box.
const CLUSTER_PADDING = 48;
// Gap between two independent components once they're tiled side by side —
// bigger than CLUSTER_PADDING since these aren't even related, unlike a
// cluster's own members.
const COMPONENT_GAP = 120;
// Horizontal gap between one rank "band" and the next, and the gap between
// items sharing a band (see `layoutComponent`). Both are generous on
// purpose: this is the room a ref crossing several ranks has to arc around
// without visually cutting through a table it isn't connected to.
const RANK_GAP = 160;
const ITEM_GAP = 70;
// A rank this small or smaller stays a plain single column — short chains
// and small branches read fine that way. Only a *wide* rank (a hub table's
// dozen children, a schema's pile of otherwise-unrelated leaf tables that
// still happened to land in the same rank) gets reflowed into a grid.
const MAX_SINGLE_COLUMN_RANK = 3;

export interface AutoLayoutResult {
  tables: Map<string, Position>;
  /** Zones whose member tables moved enough to warrant resizing/repositioning the zone rectangle around its new cluster. Zones with fewer than two members are left untouched. */
  zones: Map<string, { position: Position; size: Size }>;
}

/** Mirrors TableNode's own row-visibility logic, so dagre sizes nodes close to their actual rendered height. */
function visibleRowCount(table: Table, refFieldIds: Set<string>): number {
  if (table.detailLevel === "compact") return 0;
  if (table.detailLevel === "full") return table.fields.length;
  return table.fields.filter((f) => f.pk || refFieldIds.has(f.id)).length;
}

/** Same rectangle-containment rule the zone-drag handler uses to decide what sweeps along with a zone, applied here to *discover* zone membership instead. */
function tablesInZone(zone: Zone, tables: Table[]): Set<string> {
  const ids = new Set<string>();
  for (const table of tables) {
    const { x, y } = table.position;
    const inX = x >= zone.position.x && x <= zone.position.x + zone.size.width;
    const inY = y >= zone.position.y && y <= zone.position.y + zone.size.height;
    if (inX && inY) ids.add(table.id);
  }
  return ids;
}

/**
 * Assigns each table to a dagre "cluster" (a compound-graph parent node), so
 * tables that belong together stay visually grouped and get spaced apart from
 * every other cluster as a block, instead of every table competing for
 * position individually and groups/zones ending up interleaved.
 *
 * An explicit `TableGroup` wins over spatial zone membership — it's a
 * deliberate choice the user made, while a table merely sitting inside a
 * zone's current rectangle is just wherever it happened to be dragged before
 * this layout ran. A cluster of one isn't worth the overhead, so groups/zones
 * with fewer than two (still-existing) member tables are ignored.
 */
function assignClusters(tables: Table[], zones: Zone[], tableGroups: TableGroup[]): Map<string, string> {
  const tableIds = new Set(tables.map((t) => t.id));
  const clusterOf = new Map<string, string>();

  for (const group of tableGroups) {
    const members = group.tableIds.filter((id) => tableIds.has(id));
    if (members.length < 2) continue;
    const clusterId = `group:${group.id}`;
    for (const id of members) if (!clusterOf.has(id)) clusterOf.set(id, clusterId);
  }

  for (const zone of zones) {
    const members = tablesInZone(zone, tables);
    if (members.size < 2) continue;
    const clusterId = `zone:${zone.id}`;
    for (const id of members) if (!clusterOf.has(id)) clusterOf.set(id, clusterId);
  }

  return clusterOf;
}

/**
 * Groups tables into independent components: two tables land in the same
 * component if a ref connects them (directly or transitively) or if they
 * share a cluster (`TableGroup`/`Zone`). Tables with neither — a schema's
 * standalone lookup tables, say — each end up as their own singleton
 * component.
 *
 * This is the fix for a single dagre pass producing one long vertical strip:
 * dagre's rank algorithm has no reason to spread unconnected nodes apart, so
 * every disconnected table used to pile into the same rank, stacked one atop
 * the next. Laying each component out on its own and packing the results
 * into a grid (see `computeAutoLayout`) spreads them across both axes instead.
 */
function groupIntoComponents(tables: Table[], clusterOf: Map<string, string>, refs: Ref[]): Table[][] {
  const parent = new Map<string, string>(tables.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const ref of refs) {
    if (ref.from.tableId === ref.to.tableId) continue;
    if (!parent.has(ref.from.tableId) || !parent.has(ref.to.tableId)) continue;
    union(ref.from.tableId, ref.to.tableId);
  }

  const membersByCluster = new Map<string, string[]>();
  for (const [tableId, clusterId] of clusterOf) {
    const list = membersByCluster.get(clusterId);
    if (list) list.push(tableId);
    else membersByCluster.set(clusterId, [tableId]);
  }
  for (const members of membersByCluster.values()) {
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  }

  const componentsByRoot = new Map<string, Table[]>();
  for (const table of tables) {
    const root = find(table.id);
    const list = componentsByRoot.get(root);
    if (list) list.push(table);
    else componentsByRoot.set(root, [table]);
  }
  return Array.from(componentsByRoot.values());
}

/**
 * One placeable unit within a rank band: either a single ungrouped table, or
 * a whole cluster (its members keep dagre's own tight internal arrangement —
 * only the cluster's outer position moves).
 */
interface RankItem {
  rank: number;
  order: number;
  width: number;
  height: number;
  /** Commits this item's final table position(s), given the item's own top-left in the component's coordinate space. */
  place: (topLeft: Position) => void;
}

/**
 * Runs dagre (with cluster support) over one component's tables/refs/zones/
 * groups purely to get each table's *topology* — which rank it falls in
 * (its distance from the component's sources) and its crossing-minimized
 * order within that rank — then discards dagre's own x/y for anything
 * outside a cluster and lays each rank out itself as a compact block sized
 * to its own content.
 *
 * This is the fix for dagre piling a wide rank (a hub table's dozen
 * children, several unrelated tables that happened to land at the same
 * depth) into one long vertical column: a plain layered layout only ever
 * spreads nodes along the rank's cross-axis, with nothing capping how many
 * of them stack there. Reflowing a rank with more than
 * `MAX_SINGLE_COLUMN_RANK` items into its own little grid keeps the whole
 * component roughly as wide as it is tall instead of stretching endlessly
 * downward, and — because each rank's *own* width is added to the running
 * horizontal offset before laying out the next one — two directly-connected
 * tables stay close together (adjacent ranks, same neighbourhood in the
 * grid) instead of ending up wherever a single shared column forced them.
 */
function layoutComponent(
  tables: Table[],
  refs: Ref[],
  zones: Zone[],
  tableGroups: TableGroup[],
  sizes: Map<string, { width: number; height: number }>,
): { tablePositions: Map<string, Position>; zonePositions: Map<string, { position: Position; size: Size }> } {
  const clusterOf = assignClusters(tables, zones, tableGroups);
  const clusterIds = new Set(clusterOf.values());

  const graph = new dagre.graphlib.Graph({ compound: clusterIds.size > 0 });
  graph.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  // Cluster nodes must exist before any table references one as a parent;
  // dagre computes each cluster's own width/height from its children, so no
  // explicit size is set here.
  for (const clusterId of clusterIds) graph.setNode(clusterId, {});

  for (const table of tables) {
    const size = sizes.get(table.id);
    if (!size) continue;
    graph.setNode(table.id, size);
    const cluster = clusterOf.get(table.id);
    if (cluster) graph.setParent(table.id, cluster);
  }
  for (const ref of refs) {
    if (ref.from.tableId === ref.to.tableId) continue; // dagre can't usefully lay out a self-loop
    if (!sizes.has(ref.from.tableId) || !sizes.has(ref.to.tableId)) continue;
    graph.setEdge(ref.from.tableId, ref.to.tableId);
  }

  dagre.layout(graph);

  const tablePositions = new Map<string, Position>();

  // One rank item per ungrouped table...
  const items: RankItem[] = [];
  for (const table of tables) {
    if (clusterOf.has(table.id)) continue; // represented by its cluster below instead
    const node = graph.node(table.id);
    const size = sizes.get(table.id);
    if (!node || !size || node.rank === undefined) continue;
    items.push({
      rank: node.rank,
      order: node.order ?? 0,
      width: size.width,
      height: size.height,
      place: (topLeft) => tablePositions.set(table.id, topLeft),
    });
  }
  // ...and one per cluster, sized to dagre's own (already tight) bounding
  // box for it — its members' positions relative to that box are preserved
  // exactly, only the box itself moves into its rank's band. A compound
  // node's own label never carries `rank`/`order` (dagre only ever assigns
  // those to its leaf children), so the cluster's slot is derived from
  // whichever of its members ranks lowest — its "leading edge".
  for (const clusterId of clusterIds) {
    const node = graph.node(clusterId);
    if (!node) continue;
    const members = tables.filter((t) => clusterOf.get(t.id) === clusterId);
    const memberRanks = members.map((t) => graph.node(t.id)?.rank).filter((r): r is number => r !== undefined);
    if (memberRanks.length === 0) continue;
    const rank = Math.min(...memberRanks);
    const order = Math.min(...members.map((t) => graph.node(t.id)?.order ?? 0));
    const clusterTopLeft: Position = { x: node.x - node.width / 2, y: node.y - node.height / 2 };
    const offsets = members.map((t) => {
      const memberNode = graph.node(t.id);
      const size = sizes.get(t.id)!;
      return {
        id: t.id,
        dx: memberNode.x - size.width / 2 - clusterTopLeft.x,
        dy: memberNode.y - size.height / 2 - clusterTopLeft.y,
      };
    });
    items.push({
      rank,
      order,
      width: node.width,
      height: node.height,
      place: (topLeft) => {
        for (const { id, dx, dy } of offsets) tablePositions.set(id, { x: topLeft.x + dx, y: topLeft.y + dy });
      },
    });
  }

  const byRank = new Map<number, RankItem[]>();
  for (const item of items) {
    const list = byRank.get(item.rank);
    if (list) list.push(item);
    else byRank.set(item.rank, [item]);
  }
  for (const list of byRank.values()) list.sort((a, b) => a.order - b.order);
  const ranks = Array.from(byRank.keys()).sort((a, b) => a - b);

  // Each rank becomes its own band: a single column when small, a roughly
  // square grid (uniform cell size, sized to the rank's largest item) once
  // it's wide enough to matter. Bands never collide with one another — each
  // one's actual width is folded into `cursorX` before the next is placed —
  // and are vertically centered against the tallest band so a short rank
  // next to a tall, gridded one doesn't look pinned to the top.
  const bandHeights = new Map<number, number>();
  const bandLayout = new Map<number, { cursorX: number; cellWidth: number; cellHeight: number; cols: number }>();
  let cursorX = 0;
  for (const rank of ranks) {
    const rankItems = byRank.get(rank)!;
    const cols = rankItems.length <= MAX_SINGLE_COLUMN_RANK ? 1 : Math.ceil(Math.sqrt(rankItems.length));
    const rows = Math.ceil(rankItems.length / cols);
    const cellWidth = Math.max(...rankItems.map((i) => i.width));
    const cellHeight = Math.max(...rankItems.map((i) => i.height));
    const bandWidth = cols * cellWidth + (cols - 1) * ITEM_GAP;
    const bandHeight = rows * cellHeight + (rows - 1) * ITEM_GAP;
    bandHeights.set(rank, bandHeight);
    bandLayout.set(rank, { cursorX, cellWidth, cellHeight, cols });
    cursorX += bandWidth + RANK_GAP;
  }
  const maxBandHeight = Math.max(0, ...bandHeights.values());

  for (const rank of ranks) {
    const rankItems = byRank.get(rank)!;
    const { cursorX: bandX, cellWidth, cellHeight, cols } = bandLayout.get(rank)!;
    const yOffset = (maxBandHeight - bandHeights.get(rank)!) / 2;
    rankItems.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      item.place({
        x: bandX + col * (cellWidth + ITEM_GAP),
        y: yOffset + row * (cellHeight + ITEM_GAP),
      });
    });
  }

  const zonePositions = new Map<string, { position: Position; size: Size }>();
  for (const zone of zones) {
    const clusterId = `zone:${zone.id}`;
    if (!clusterIds.has(clusterId)) continue; // fewer than two members: left wherever the user put it
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tables) {
      if (clusterOf.get(t.id) !== clusterId) continue;
      const pos = tablePositions.get(t.id);
      const size = sizes.get(t.id);
      if (!pos || !size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }
    if (!Number.isFinite(minX)) continue;
    zonePositions.set(zone.id, {
      position: { x: minX - CLUSTER_PADDING, y: minY - CLUSTER_PADDING },
      size: { width: maxX - minX + CLUSTER_PADDING * 2, height: maxY - minY + CLUSTER_PADDING * 2 },
    });
  }

  return { tablePositions, zonePositions };
}

/**
 * Lays out tables left-to-right by ref direction via dagre, sized to roughly
 * match their rendered height. Tables belonging to the same `TableGroup` or
 * sitting inside the same `Zone` are laid out as a dagre compound cluster —
 * dagre packs each cluster's members tightly together internally and treats
 * the cluster as a single block when spacing it apart from every other
 * cluster and every ungrouped table, so groups/zones read as distinct
 * neighbourhoods on the canvas instead of getting shuffled together.
 *
 * Independent components (tables with no ref/cluster path between them —
 * e.g. a handful of unrelated lookup tables) each get their own compact
 * sub-layout, then those sub-layouts are packed into a roughly square grid
 * (`COMPONENT_GAP` apart) instead of being thrown into a single dagre pass,
 * which otherwise piles every disconnected table into one tall vertical
 * column: dagre only spreads nodes apart along edges, so nodes with none
 * have nothing to spread them.
 *
 * `zones`/`tableGroups` are optional so callers that don't care about
 * clustering (tests, or a future bulk-layout of a table subset) can omit
 * them and get a single-component layout.
 */
export function computeAutoLayout(
  tables: Table[],
  refs: Ref[],
  zones: Zone[] = [],
  tableGroups: TableGroup[] = [],
): AutoLayoutResult {
  const refFieldIdsByTable = new Map<string, Set<string>>();
  for (const table of tables) refFieldIdsByTable.set(table.id, new Set());
  for (const ref of refs) {
    refFieldIdsByTable.get(ref.from.tableId)?.add(ref.from.fieldId);
    refFieldIdsByTable.get(ref.to.tableId)?.add(ref.to.fieldId);
  }

  const sizes = new Map<string, { width: number; height: number }>();
  for (const table of tables) {
    const height = HEADER_HEIGHT + visibleRowCount(table, refFieldIdsByTable.get(table.id) ?? new Set()) * ROW_HEIGHT;
    sizes.set(table.id, { width: NODE_WIDTH, height });
  }

  const clusterOf = assignClusters(tables, zones, tableGroups);
  const components = groupIntoComponents(tables, clusterOf, refs);

  interface PackedComponent {
    tablePositions: Map<string, Position>;
    zonePositions: Map<string, { position: Position; size: Size }>;
    width: number;
    height: number;
  }
  const packed: PackedComponent[] = components.map((compTables) => {
    const compIds = new Set(compTables.map((t) => t.id));
    const compRefs = refs.filter((r) => compIds.has(r.from.tableId) && compIds.has(r.to.tableId));
    const compZones = zones.filter((z) => tablesInZone(z, compTables).size >= 2);
    const compGroups = tableGroups.filter((g) => g.tableIds.some((id) => compIds.has(id)));

    const { tablePositions, zonePositions } = layoutComponent(compTables, compRefs, compZones, compGroups, sizes);

    // Normalize to a local origin so packing below can place this component
    // purely by translation, regardless of where dagre happened to put it.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, pos] of tablePositions) {
      const size = sizes.get(id);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }
    for (const zone of zonePositions.values()) {
      minX = Math.min(minX, zone.position.x);
      minY = Math.min(minY, zone.position.y);
      maxX = Math.max(maxX, zone.position.x + zone.size.width);
      maxY = Math.max(maxY, zone.position.y + zone.size.height);
    }
    for (const pos of tablePositions.values()) {
      pos.x -= minX;
      pos.y -= minY;
    }
    for (const zone of zonePositions.values()) {
      zone.position.x -= minX;
      zone.position.y -= minY;
    }

    return { tablePositions, zonePositions, width: maxX - minX, height: maxY - minY };
  });

  // Shelf-pack the components into a roughly square overall canvas — tallest
  // first, so a handful of big clusters set the row heights and the smaller
  // (often singleton) components backfill the remaining width instead of
  // trailing off in one long strip. The row width targets *columns* of
  // components (≈ ceil(sqrt(count)), rounded up rather than down to bias
  // toward more columns/less height — the whole point of packing components
  // in the first place), not raw area: an area-based target badly
  // underestimates once per-item gaps are accounted for, which just
  // reproduces the single-column pileup this is meant to avoid.
  packed.sort((a, b) => b.height - a.height);
  const avgWidth = packed.length > 0 ? packed.reduce((sum, c) => sum + c.width, 0) / packed.length : NODE_WIDTH;
  const columns = Math.max(1, Math.ceil(Math.sqrt(packed.length)));
  const targetRowWidth = columns * (avgWidth + COMPONENT_GAP);

  const tablePositions = new Map<string, Position>();
  const zonePositions = new Map<string, { position: Position; size: Size }>();
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  for (const component of packed) {
    if (shelfX > 0 && shelfX + component.width > targetRowWidth) {
      shelfX = 0;
      shelfY += shelfHeight + COMPONENT_GAP;
      shelfHeight = 0;
    }
    for (const [id, pos] of component.tablePositions) {
      tablePositions.set(id, { x: pos.x + shelfX, y: pos.y + shelfY });
    }
    for (const [id, zone] of component.zonePositions) {
      zonePositions.set(id, {
        position: { x: zone.position.x + shelfX, y: zone.position.y + shelfY },
        size: zone.size,
      });
    }
    shelfX += component.width + COMPONENT_GAP;
    shelfHeight = Math.max(shelfHeight, component.height);
  }

  return { tables: tablePositions, zones: zonePositions };
}
