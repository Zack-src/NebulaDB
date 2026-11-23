import * as Y from "yjs";
import { getZonesMap, type Zone } from "@nebuladb/shared";
import type { ZoneNodeType } from "@/features/editor/nodes/nodeTypes";

/** Low enough that a selected zone (+1000, `elevateNodesOnSelect`) stays under groups and tables. */
export const ZONE_Z_INDEX = -2002;

export function buildZoneNodes(
  zones: Zone[],
  doc: Y.Doc,
  palette: string[],
  onPaletteChange: (next: string[]) => void,
  canWrite = true,
): ZoneNodeType[] {
  return zones.map((zone) => ({
    id: zone.id,
    position: zone.position,
    width: zone.size.width,
    height: zone.size.height,
    type: "zone",
    // Behind everything, even selected: the flow raises a selected node by 1000, and a selected zone used to
    // cover its groups (-1) and tables (0) — they could no longer be clicked or renamed inside it.
    zIndex: ZONE_Z_INDEX,
    data: {
      zone,
      palette,
      readOnly: !canWrite,
      onPaletteChange,
      onLabelChange: (label: string) => {
        const zonesMap = getZonesMap(doc);
        const current = zonesMap.get(zone.id);
        if (current) zonesMap.set(zone.id, { ...current, label });
      },
      onColorChange: (color: string) => {
        const zonesMap = getZonesMap(doc);
        const current = zonesMap.get(zone.id);
        if (current) zonesMap.set(zone.id, { ...current, style: { ...current.style, color } });
      },
      onResize: (position, size) => {
        const zonesMap = getZonesMap(doc);
        const current = zonesMap.get(zone.id);
        if (current) zonesMap.set(zone.id, { ...current, position, size });
      },
    },
  }));
}
