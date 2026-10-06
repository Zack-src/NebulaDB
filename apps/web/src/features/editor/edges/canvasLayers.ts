/**
 * Stacking order for everything painted on the canvas. Svelte Flow renders nodes *after* the
 * edge-label layer (so nodes win z-index ties) and lifts a selected or dragged node to 1000.
 * The numbers live here, not as scattered bare `z-10`s.
 */

/** What @xyflow/system assigns to a selected/dragged node. */
const NODE_SELECTED_Z = 1000;
/** Waypoint dots and the selected-edge toolbar: they have to stay clickable wherever the line runs. */
export const EDGE_CHROME_Z = NODE_SELECTED_Z + 100;
