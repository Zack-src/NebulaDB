import * as Y from "yjs";
import { getZonesMap, type Zone } from "@athanordb/shared";
import type { ZoneNodeType } from "@/features/editor/nodes/ZoneNode";

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
