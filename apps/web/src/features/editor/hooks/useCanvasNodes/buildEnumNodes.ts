import * as Y from "yjs";
import { getEnumsMap, type EnumDef, type EnumValue } from "@athanordb/shared";
import type { EnumNodeType } from "@/features/editor/nodes/EnumNode";

export function buildEnumNodes(enums: EnumDef[], doc: Y.Doc, canWrite = true): EnumNodeType[] {
  return enums.map((enumDef) => ({
    id: enumDef.id,
    position: enumDef.position,
    type: "enum",
    data: {
      enumDef,
      readOnly: !canWrite,
      onRename: (name: string) => {
        const enumsMap = getEnumsMap(doc);
        const current = enumsMap.get(enumDef.id);
        if (current) enumsMap.set(enumDef.id, { ...current, name });
      },
      onAddValue: () => {
        const enumsMap = getEnumsMap(doc);
        const current = enumsMap.get(enumDef.id);
        if (!current) return;
        const value: EnumValue = { id: crypto.randomUUID(), name: `value_${current.values.length + 1}` };
        enumsMap.set(enumDef.id, { ...current, values: [...current.values, value] });
      },
      onRenameValue: (valueId: string, name: string) => {
        const enumsMap = getEnumsMap(doc);
        const current = enumsMap.get(enumDef.id);
        if (!current) return;
        enumsMap.set(enumDef.id, {
          ...current,
          values: current.values.map((v) => (v.id === valueId ? { ...v, name } : v)),
        });
      },
      onDeleteValue: (valueId: string) => {
        const enumsMap = getEnumsMap(doc);
        const current = enumsMap.get(enumDef.id);
        if (!current) return;
        enumsMap.set(enumDef.id, { ...current, values: current.values.filter((v) => v.id !== valueId) });
      },
      onReorderValue: (valueId: string, direction: "up" | "down") => {
        const enumsMap = getEnumsMap(doc);
        const current = enumsMap.get(enumDef.id);
        if (!current) return;
        const index = current.values.findIndex((v) => v.id === valueId);
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (index < 0 || swapWith < 0 || swapWith >= current.values.length) return;
        const values = [...current.values];
        [values[index], values[swapWith]] = [values[swapWith], values[index]];
        enumsMap.set(enumDef.id, { ...current, values });
      },
    },
  }));
}
