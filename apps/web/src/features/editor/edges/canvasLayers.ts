/**
 * Stacking order for everything React Flow paints on the canvas.
 *
 * React Flow renders the node layer *after* the edge-label layer, so on a
 * z-index tie the nodes win purely on DOM order — which is why a relation's
 * midpoint toolbar disappeared under any table it happened to cross. It also
 * lifts a selected or dragged node to 1000 of its own accord, so beating an
 * idle node is not enough.
 *
 * These constants exist so the numbers are auditable in one place instead of
 * being scattered as bare `z-10`s that no longer mean anything.
 */

/** What @xyflow/system assigns to a selected/dragged node. */
export const NODE_SELECTED_Z = 1000;
/** Cardinality chips — above every node, below the interactive chrome. */
export const EDGE_LABEL_Z = NODE_SELECTED_Z + 1;
/** Waypoint dots and the selected-edge toolbar: they have to stay clickable wherever the line runs. */
export const EDGE_CHROME_Z = NODE_SELECTED_Z + 100;
